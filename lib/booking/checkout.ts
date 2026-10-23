import "server-only";
import { and, count, eq, gt, ne, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { guest, reservation } from "@/db/schema";
import type { CheckoutResponse, GuestDetails } from "@/lib/api/contracts";
import { normalizeEmail } from "@/lib/auth/session";
import { ApiError, tooMany } from "@/lib/http/api";
import { log } from "@/lib/log";
import { payments } from "@/lib/payments";
import { OPEN_INTENT_STATES, type PaymentIntentInfo } from "@/lib/payments/types";
import { hashIdentifier } from "@/lib/security/crypto";
import { LIMITS, rateLimit } from "@/lib/security/rate-limit";
import { HOLD_LIMIT_EMAIL, MAX_ACTIVE_HOLDS } from "./holds";
import { loadBooking } from "./load";
import { confirmPayment } from "./payment-events";

/**
 * POST /api/holds/{id}/checkout (PRD G-7, S-1, S-4). Saves the guest's details and
 * creates (or reuses) the PaymentIntent for the hold's stored server price. Nothing in
 * the request can change the amount: the body schema has no price field, and the
 * amount is read from the reservation row.
 */

/** Stripe's minimum charge in USD. */
const MIN_CHARGE_CENTS = 50;

export async function checkout(id: string, details: GuestDetails): Promise<CheckoutResponse> {
  const limited = await rateLimit("checkout", id, LIMITS.checkout);
  if (!limited.ok) throw tooMany(limited.retryAfterSeconds);

  const b = await loadBooking(id);
  if (!b) throw new ApiError(404, "hold_not_found", "This hold could not be found.");
  const { r, v } = b;
  if (r.status === "confirmed" || r.status === "seated") {
    throw new ApiError(409, "hold_not_active", "This table is already paid for. Check your email for the confirmation.");
  }
  if (r.status !== "held" || !r.holdExpiresAt || r.holdExpiresAt.getTime() <= Date.now()) {
    throw new ApiError(409, "hold_expired", "Your hold has ended and the table was released. Choose it again to hold it.");
  }
  if (r.priceCents < MIN_CHARGE_CENTS) throw new ApiError(422, "not_bookable", "This table cannot be booked online right now.");
  if (!v.stripeAccountId) throw new ApiError(503, "payments_unavailable", "Payments are not set up for this venue yet.");

  const emailNorm = normalizeEmail(details.email);
  await db().transaction(async (tx) => {
    // Holds per email are counted under a lock, so two checkouts cannot pass the limit together.
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${`hold-email:${hashIdentifier("email", emailNorm)}`}, 0))`,
    );
    const [active] = await tx
      .select({ n: count() })
      .from(reservation)
      .where(
        and(
          eq(reservation.emailNorm, emailNorm),
          eq(reservation.status, "held"),
          gt(reservation.holdExpiresAt, sql`now()`),
          ne(reservation.id, r.id),
        ),
      );
    if ((active?.n ?? 0) >= MAX_ACTIVE_HOLDS) throw new ApiError(429, "hold_limit", HOLD_LIMIT_EMAIL);

    const values = {
      name: details.name,
      email: details.email.trim(),
      mobile: details.mobile,
      occasion: details.occasion ?? null,
      note: details.note || null,
    };
    let guestId = r.guestId;
    if (guestId) await tx.update(guest).set(values).where(eq(guest.id, guestId));
    else guestId = (await tx.insert(guest).values(values).returning({ id: guest.id }))[0]!.id;
    const updated = await tx
      .update(reservation)
      .set({ guestId, emailNorm, paymentError: null, updatedAt: new Date() })
      .where(and(eq(reservation.id, r.id), eq(reservation.status, "held")))
      .returning({ id: reservation.id });
    if (!updated.length)
      throw new ApiError(409, "hold_expired", "Your hold has ended and the table was released. Choose it again to hold it.");
  });

  const provider = payments();
  let intent: PaymentIntentInfo | null = null;
  let outcome = "created";
  if (r.paymentIntentId) {
    const existing = await provider.retrievePaymentIntent(r.paymentIntentId);
    if (existing.status === "succeeded") {
      await confirmPayment(existing.id, existing.card, "poll");
      throw new ApiError(409, "hold_not_active", "This table is already paid for. Check your email for the confirmation.");
    }
    if (OPEN_INTENT_STATES.includes(existing.status) && existing.amount === r.priceCents) {
      intent = existing;
      outcome = "reused";
      await provider.updateReceiptEmail(existing.id, details.email);
    }
  }
  intent ??= await provider.createPaymentIntent({
    amount: r.priceCents,
    currency: "usd",
    applicationFeeAmount: r.applicationFeeCents,
    destination: v.stripeAccountId,
    metadata: { reservation_id: r.id, venue_id: v.id, table: b.table.code },
    receiptEmail: details.email,
    description: `${b.table.label} at ${v.name}`,
    // A replaced intent (only after a cancel) needs a fresh key; the first is per reservation.
    idempotencyKey: r.paymentIntentId ? `pi-${r.id}-${Date.now()}` : `pi-${r.id}`,
  });
  if (!intent.clientSecret) throw new Error(`payment intent ${intent.id} has no client secret`);

  if (intent.id !== r.paymentIntentId) {
    await db().update(reservation).set({ paymentIntentId: intent.id, updatedAt: new Date() }).where(eq(reservation.id, r.id));
  }
  log.info("payment.intent_ready", {
    reservationId: r.id,
    venueId: v.id,
    paymentIntentId: intent.id,
    amountCents: intent.amount,
    applicationFeeCents: r.applicationFeeCents,
    outcome,
  });
  return {
    payment: {
      mode: provider.mode,
      paymentIntentId: intent.id,
      clientSecret: intent.clientSecret,
      publishableKey: provider.publishableKey,
      amountCents: intent.amount,
      currency: "usd",
    },
  };
}
