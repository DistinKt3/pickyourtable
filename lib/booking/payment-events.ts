import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { db, pgCode, PG } from "@/db/client";
import { reservation } from "@/db/schema";
import { log } from "@/lib/log";
import { payments } from "@/lib/payments";
import type { PaymentError } from "@/lib/payments/types";
import { audit, SYSTEM } from "./audit";
import { type LoadedBooking, loadBooking, loadBookingByIntent } from "./load";
import { sendBookingConfirmed, sendLatePaymentRefunded, sendVenueNewBooking } from "./notify";
import { owe, settleRefund } from "./refunds";

/**
 * What happens when the provider reports on a payment. One path for the webhook, the
 * guest's status poll (when a webhook is late) and the 30-second job, so the outcome
 * never depends on which of them noticed first. Every transition is a guarded UPDATE,
 * so replays and races change nothing twice and send each email once.
 *
 * A booking is confirmed only here, and only after the provider reports success (G-7).
 */

export type ConfirmOutcome =
  | "confirmed"
  | "confirmed_late"
  | "already_confirmed"
  | "refunded_late"
  | "already_refunded"
  | "unknown_intent";

export interface ConfirmResult {
  outcome: ConfirmOutcome;
  reservationId: string | null;
  amountCents: number | null;
}

type Card = { brand: string; last4: string } | null;

/** Plain words for a declined payment, shown to the guest while the hold lasts. No blame. */
export function declineMessage(e: PaymentError | null): string {
  switch (e?.declineCode ?? e?.code) {
    case "insufficient_funds":
      return "Your bank declined this payment. Try another card or payment method.";
    case "expired_card":
      return "This card has expired. Try another card or payment method.";
    case "incorrect_cvc":
    case "invalid_cvc":
      return "The security code did not match. Check it and try again.";
    case "processing_error":
      return "The payment could not be processed. Please try again.";
    case "authentication_required":
      return "Your bank needs you to approve this payment. Please try again.";
    default:
      return "The card was declined. Try another card or payment method.";
  }
}

async function cardFor(paymentIntentId: string, card: Card): Promise<Card> {
  if (card) return card;
  try {
    return (await payments().retrievePaymentIntent(paymentIntentId)).card;
  } catch {
    return null;
  }
}

/** The provider says this PaymentIntent succeeded. */
export async function confirmPayment(
  paymentIntentId: string,
  cardIn: Card,
  source: "webhook" | "poll" | "job",
): Promise<ConfirmResult> {
  const b = await loadBookingByIntent(paymentIntentId);
  if (!b) {
    log.warn("payment.unmatched", { paymentIntentId, source, outcome: "unknown_intent" });
    return { outcome: "unknown_intent", reservationId: null, amountCents: null };
  }
  return settle(b, paymentIntentId, cardIn, source, 0);
}

async function settle(
  b: LoadedBooking,
  paymentIntentId: string,
  cardIn: Card,
  source: string,
  depth: number,
): Promise<ConfirmResult> {
  const { r } = b;
  const done = (outcome: ConfirmOutcome): ConfirmResult => ({ outcome, reservationId: r.id, amountCents: r.priceCents });

  if (r.status === "confirmed" || r.status === "seated" || r.status === "no_show") return done("already_confirmed");
  // A booking that was paid and later cancelled has already been through this path.
  if (r.status === "cancelled" && r.confirmedAt) return done("already_confirmed");
  if (r.refundDueCents > 0) {
    // Already being refunded (a late payment, or a refund recorded before this event).
    if (r.refundCents < r.refundDueCents) await settleRefund(r.id);
    return done("already_refunded");
  }
  const card = await cardFor(paymentIntentId, cardIn);
  const cardSet = card ? { cardBrand: card.brand, cardLast4: card.last4 } : {};

  if (r.status === "held") {
    const [row] = await db()
      .update(reservation)
      .set({ status: "confirmed", confirmedAt: new Date(), paymentError: null, updatedAt: new Date(), ...cardSet })
      .where(and(eq(reservation.id, r.id), eq(reservation.status, "held")))
      .returning();
    if (!row) return retry(b, paymentIntentId, cardIn, source, depth);
    await afterConfirm({ ...b, r: row }, "confirmed", source);
    return done("confirmed");
  }

  // The hold ended before the money arrived. A released hold was given up by the guest;
  // an expired one is kept if the table is still free, else refunded (PRD S-3).
  if (r.status === "expired" && r.cancelReason !== "released") {
    try {
      const [row] = await db()
        .update(reservation)
        .set({
          status: "confirmed",
          confirmedAt: new Date(),
          cancelReason: null,
          paymentError: null,
          updatedAt: new Date(),
          ...cardSet,
        })
        .where(and(eq(reservation.id, r.id), eq(reservation.status, "expired"), eq(reservation.refundDueCents, 0)))
        .returning();
      if (!row) return retry(b, paymentIntentId, cardIn, source, depth);
      await afterConfirm({ ...b, r: row }, "confirmed_late", source);
      return done("confirmed_late");
    } catch (e) {
      if (pgCode(e) !== PG.exclusionViolation) throw e;
    }
  }

  // The table went to someone else (or the guest let it go): refund in full, at once.
  if (card) {
    await db()
      .update(reservation)
      .set({ ...cardSet, updatedAt: new Date() })
      .where(eq(reservation.id, r.id));
  }
  const raised = await owe(r.id, r.priceCents, {
    cancelReason: r.status === "expired" && r.cancelReason === "released" ? "released" : "late_payment",
  });
  if (!raised) return done("already_refunded");
  const settled = await settleRefund(r.id);
  await audit({
    venueId: r.venueId,
    actor: SYSTEM,
    action: "payment.refunded_late",
    reservationId: r.id,
    amountCents: r.priceCents,
    details: { paymentIntentId, refundId: settled.refundId, source },
  });
  log.info("payment.succeeded", {
    reservationId: r.id,
    venueId: r.venueId,
    paymentIntentId,
    amountCents: r.priceCents,
    source,
    outcome: "refunded_late",
  });
  const fresh = await loadBooking(r.id, { venue: b.v });
  if (fresh) await sendLatePaymentRefunded(fresh);
  return done("refunded_late");
}

async function retry(
  b: LoadedBooking,
  paymentIntentId: string,
  card: Card,
  source: string,
  depth: number,
): Promise<ConfirmResult> {
  // The row changed between reading and writing (the job expired it, say). Read it again once.
  const fresh = depth < 2 ? await loadBooking(b.r.id, { venue: b.v }) : null;
  if (!fresh) return { outcome: "already_confirmed", reservationId: b.r.id, amountCents: b.r.priceCents };
  return settle(fresh, paymentIntentId, card, source, depth + 1);
}

async function afterConfirm(b: LoadedBooking, outcome: "confirmed" | "confirmed_late", source: string) {
  await audit({
    venueId: b.r.venueId,
    actor: SYSTEM,
    action: "booking.confirmed",
    reservationId: b.r.id,
    amountCents: b.r.priceCents,
    details: { paymentIntentId: b.r.paymentIntentId, source, late: outcome === "confirmed_late" },
  });
  log.info("payment.succeeded", {
    reservationId: b.r.id,
    venueId: b.r.venueId,
    paymentIntentId: b.r.paymentIntentId,
    amountCents: b.r.priceCents,
    applicationFeeCents: b.r.applicationFeeCents,
    source,
    outcome,
  });
  await sendBookingConfirmed(b);
  await sendVenueNewBooking(b);
}

/** A payment attempt was declined: the hold stays, and the guest sees why in plain words. */
export async function recordPaymentFailure(paymentIntentId: string, error: PaymentError | null): Promise<string | null> {
  const message = declineMessage(error);
  const rows = await db()
    .update(reservation)
    .set({ paymentError: message, updatedAt: new Date() })
    .where(and(eq(reservation.paymentIntentId, paymentIntentId), eq(reservation.status, "held")))
    .returning({ id: reservation.id, venueId: reservation.venueId, priceCents: reservation.priceCents });
  const row = rows[0];
  log.info("payment.failed", {
    reservationId: row?.id ?? null,
    venueId: row?.venueId ?? null,
    paymentIntentId,
    amountCents: row?.priceCents ?? null,
    code: error?.declineCode ?? error?.code ?? null,
    outcome: row ? "hold_kept" : "no_active_hold",
  });
  return row?.id ?? null;
}

/**
 * The provider reports refunds on a charge (also ones made outside this app, such as
 * from the Stripe dashboard). Records the total; a hold whose money was returned can
 * never be confirmed afterwards.
 */
export async function recordProviderRefund(
  paymentIntentId: string,
  amountRefunded: number,
  refundId: string | null,
): Promise<string | null> {
  const res = await db().execute<{ id: string }>(sql`
    UPDATE reservation
       SET refund_cents = LEAST(price_cents, GREATEST(refund_cents, ${amountRefunded}::int)),
           refund_due_cents = LEAST(price_cents, GREATEST(refund_due_cents, ${amountRefunded}::int)),
           refund_id = COALESCE(${refundId}::text, refund_id),
           refunded_at = COALESCE(refunded_at, now()),
           cancel_reason = CASE WHEN status = 'held' THEN 'refunded' ELSE cancel_reason END,
           status = CASE WHEN status = 'held' THEN 'expired'::reservation_status ELSE status END,
           updated_at = now()
     WHERE payment_intent_id = ${paymentIntentId}
     RETURNING id
  `);
  return res.rows[0]?.id ?? null;
}
