import "server-only";
import { and, count, eq, gt, lte, ne, sql } from "drizzle-orm";
import type { NextRequest } from "next/server";
import { db, pgCode, PG } from "@/db/client";
import { reservation } from "@/db/schema";
import type { CreateHoldBody, CreateHoldResponse, HoldStatusResponse } from "@/lib/api/contracts";
import { ApiError, tooMany } from "@/lib/http/api";
import { log } from "@/lib/log";
import { payments } from "@/lib/payments";
import type { IntentStatus } from "@/lib/payments/types";
import { randomToken } from "@/lib/security/crypto";
import { LIMITS, rateLimit } from "@/lib/security/rate-limit";
import { clientIp, deviceHash, ipHash } from "@/lib/security/request";
import { verifyToken } from "@/lib/security/tokens";
import { verifyTurnstile } from "@/lib/security/turnstile";
import { fitsParty, loadBusy, similarFreeTable, tablesForSlot, wrongSizeReason } from "./availability";
import type { BookingVenue } from "./context";
import { calendarPath, holdToken, manageToken, manageUrl } from "./links";
import { type LoadedBooking, loadBooking } from "./load";
import { confirmPayment, declineMessage } from "./payment-events";
import { applicationFeeCents, priceFor } from "./pricing";
import { resolveSlot, turnOrThrow } from "./queries";
import { type Slot, slotEnd } from "./slots";
import { holdViewOf } from "./views";

/**
 * Holds (PRD G-6, S-2, S-4). A hold is a `held` reservation row: the no-overlap
 * constraint in the database decides who gets a table, so two guests holding the same
 * table and slot can never both succeed. The loser gets the most similar free table.
 */

export const MAX_ACTIVE_HOLDS = 2;

const HOLD_LIMIT_DEVICE = "You already have 2 tables on hold. Finish booking one, or release it, to hold another.";
export const HOLD_LIMIT_EMAIL = "This email already has 2 tables on hold. Finish booking one, or release it, to hold another.";
const TAKEN = "Someone just took this table.";

function takenError(alternative: ReturnType<typeof similarFreeTable>): ApiError {
  return new ApiError(409, "taken", TAKEN, { alternative });
}

async function alternativeFor(v: BookingVenue, slot: Slot, code: string, party: number, turn: number) {
  const busy = await loadBusy(v.id, slot.startsAt, slotEnd(slot.startsAt, turn));
  return similarFreeTable(v, code, tablesForSlot(v, slot, party, busy));
}

/** POST /api/v/{venue}/holds. Writes exactly one log line per attempt, whatever the outcome. */
export async function createHold(
  v: BookingVenue,
  body: CreateHoldBody,
  req: NextRequest,
  now = new Date(),
): Promise<CreateHoldResponse> {
  const device = deviceHash(req);
  const fields = { venueId: v.id, table: body.table, date: body.date, time: body.time, party: body.party };
  try {
    const result = await holdOrThrow(v, body, req, device, now);
    log.info("hold.created", {
      ...fields,
      holdId: result.hold.id,
      priceCents: result.hold.priceCents,
      expiresAt: result.hold.expiresAt,
      outcome: "held",
    });
    return result;
  } catch (e) {
    const outcome = e instanceof ApiError ? e.code : "error";
    (e instanceof ApiError ? log.info : log.error)("hold.rejected", {
      ...fields,
      outcome,
      ...(e instanceof ApiError ? {} : { error: e }),
    });
    throw e;
  }
}

async function holdOrThrow(
  v: BookingVenue,
  body: CreateHoldBody,
  req: NextRequest,
  device: string,
  now: Date,
): Promise<CreateHoldResponse> {
  const ip = clientIp(req);
  const turnstile = await verifyTurnstile(body.turnstileToken, ip);
  if (!turnstile.ok) {
    if (turnstile.reason === "unavailable") {
      throw new ApiError(503, "turnstile_unavailable", "We could not check this request just now. Please try again in a moment.");
    }
    throw new ApiError(403, "turnstile_failed", "We could not confirm this request came from a person. Please try again.");
  }
  const limited = await rateLimit("holds-ip", ipHash(req), LIMITS.holdsPerIp);
  if (!limited.ok) throw tooMany(limited.retryAfterSeconds);

  const slot = resolveSlot(v, body.date, body.time, now);
  const table = v.byCode.get(body.table);
  if (!table) throw new ApiError(404, "table_not_found", "We could not find this table.");
  if (!table.bookable) throw new ApiError(422, "not_bookable", "This table is not booked online. The host seats it on arrival.");
  const turn = turnOrThrow(v, body.party);
  if (!fitsParty(table, body.party)) throw new ApiError(409, "wrong_size", wrongSizeReason(table, body.party));
  const price = priceFor(v.rules, v.slots.weekendDays, { tier: table.tier, daypart: slot.daypart, date: slot.date });
  if (!price) throw new ApiError(422, "not_bookable", "This table cannot be booked online right now.");
  const endsAt = slotEnd(slot.startsAt, turn);

  // Blackouts are not part of the constraint; guests see them as taken (PRD O-4).
  const blocked = await db().execute(sql`
    SELECT 1 FROM blackout
     WHERE venue_id = ${v.id} AND (table_id = ${table.id} OR table_id IS NULL)
       AND during && tstzrange(${slot.startsAt.toISOString()}::timestamptz, ${endsAt.toISOString()}::timestamptz, '[)')
     LIMIT 1
  `);
  if (blocked.rows.length) throw takenError(await alternativeFor(v, slot, table.code, body.party, turn));

  let row: typeof reservation.$inferSelect;
  try {
    row = await db().transaction(async (tx) => {
      // One device's holds are counted under a lock, so parallel requests cannot pass the limit together.
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`hold-device:${device}`}, 0))`);
      const [active] = await tx
        .select({ n: count() })
        .from(reservation)
        .where(
          and(eq(reservation.deviceHash, device), eq(reservation.status, "held"), gt(reservation.holdExpiresAt, sql`now()`)),
        );
      if ((active?.n ?? 0) >= MAX_ACTIVE_HOLDS) throw new ApiError(429, "hold_limit", HOLD_LIMIT_DEVICE);

      await tx
        .update(reservation)
        .set({ status: "expired", cancelReason: "expired", updatedAt: new Date() })
        .where(
          and(eq(reservation.tableId, table.id), eq(reservation.status, "held"), lte(reservation.holdExpiresAt, sql`now()`)),
        );

      const [inserted] = await tx
        .insert(reservation)
        .values({
          venueId: v.id,
          tableId: table.id,
          partySize: body.party,
          startsAt: slot.startsAt,
          endsAt,
          daypart: slot.daypart,
          dayType: price.dayType,
          status: "held",
          holdExpiresAt: sql`now() + make_interval(mins => ${v.json.booking.holdMinutes}::int)`,
          priceCents: price.feeCents,
          applicationFeeCents: applicationFeeCents(price.feeCents, v.applicationFeeBps),
          deviceHash: device,
          ipHash: ipHash(req),
          manageNonce: randomToken(16),
        })
        .returning();
      return inserted!;
    });
  } catch (e) {
    if (pgCode(e) === PG.exclusionViolation) {
      throw takenError(await alternativeFor(v, slot, table.code, body.party, turn));
    }
    throw e;
  }
  return { hold: holdViewOf(v, row), holdToken: await holdToken(row) };
}

/** The hold token proves the caller created this hold. */
export async function requireHoldToken(req: Request, id: string): Promise<void> {
  const header = req.headers.get("authorization") ?? "";
  const token = /^Bearer\s+(\S+)$/i.exec(header)?.[1];
  const res = token ? await verifyToken("hold", token) : null;
  if (!res?.ok) {
    throw new ApiError(
      401,
      "invalid_hold_token",
      res?.reason === "expired" ? "This hold has ended. Choose the table again to hold it." : "This hold could not be found.",
    );
  }
  if (res.claims.sub !== id) throw new ApiError(401, "invalid_hold_token", "This hold could not be found.");
}

async function loadHold(id: string): Promise<LoadedBooking> {
  const b = await loadBooking(id);
  if (!b) throw new ApiError(404, "hold_not_found", "This hold could not be found.");
  return b;
}

function paymentState(b: LoadedBooking, intent: IntentStatus | null, intentError: string | null): HoldStatusResponse["payment"] {
  const { r } = b;
  if (r.confirmedAt) return { status: "succeeded", message: null };
  if (r.refundDueCents > 0) {
    return {
      status: "failed",
      message:
        r.cancelReason === "released"
          ? "Your payment arrived after you released the table, so we refunded it in full."
          : "Your payment arrived after the hold ended and another guest had booked the table, so we refunded it in full.",
    };
  }
  if (r.status !== "held" || !r.paymentIntentId) return { status: "none", message: null };
  if (intent === "processing" || intent === "succeeded") return { status: "processing", message: null };
  const message = r.paymentError ?? intentError;
  if (message) return { status: "failed", message };
  return { status: "requires_payment", message: null };
}

/** GET /api/holds/{id}: polled during checkout and on the confirmation screen. */
export async function holdStatus(id: string): Promise<HoldStatusResponse> {
  let b = await loadHold(id);
  let intent: IntentStatus | null = null;
  let intentError: string | null = null;
  if (b.r.status === "held" && b.r.paymentIntentId) {
    try {
      const pi = await payments().retrievePaymentIntent(b.r.paymentIntentId);
      intent = pi.status;
      if (pi.status === "requires_payment_method" && pi.lastError) intentError = declineMessage(pi.lastError);
      if (pi.status === "succeeded") {
        // The webhook is late: confirm through the same path it would take.
        await confirmPayment(pi.id, pi.card, "poll");
        b = await loadHold(id);
      }
    } catch (e) {
      log.warn("payment.status_unavailable", { reservationId: id, paymentIntentId: b.r.paymentIntentId, error: e });
    }
  }

  let booking: HoldStatusResponse["booking"] = null;
  if ((b.r.status === "confirmed" || b.r.status === "seated") && b.guest) {
    const token = await manageToken(b.r, b.v.timezone);
    booking = { manageUrl: manageUrl(b.v.id, token), calendarUrl: calendarPath(token), emailedTo: b.guest.email };
  }
  const hold = holdViewOf(b.v, b.r);
  // The 30-second job may not have run yet; a hold past its expiry is over either way.
  if (hold.status === "held" && b.r.holdExpiresAt && b.r.holdExpiresAt.getTime() <= Date.now()) hold.status = "expired";
  return { hold, payment: paymentState(b, intent, intentError), booking };
}

/** DELETE /api/holds/{id}: the guest lets the table go. */
export async function releaseHold(id: string): Promise<{ hold: ReturnType<typeof holdViewOf> }> {
  const [row] = await db()
    .update(reservation)
    .set({ status: "expired", cancelReason: "released", updatedAt: new Date() })
    .where(and(eq(reservation.id, id), eq(reservation.status, "held")))
    .returning();
  if (!row) {
    const b = await loadHold(id);
    if (b.r.status === "expired") return { hold: holdViewOf(b.v, b.r) };
    if (b.r.status === "confirmed") {
      throw new ApiError(
        409,
        "hold_not_active",
        "This table is already paid for. Use the link in your confirmation email to cancel.",
      );
    }
    throw new ApiError(409, "hold_not_active", "This hold has already ended.");
  }
  const b = await loadHold(id);
  let outcome = "released";
  if (row.paymentIntentId) outcome = await closeIntent(row.id, row.paymentIntentId, "release");
  log.info("hold.released", {
    holdId: id,
    venueId: row.venueId,
    paymentIntentId: row.paymentIntentId,
    priceCents: row.priceCents,
    outcome,
  });
  return { hold: holdViewOf(b.v, b.r) };
}

/**
 * Cancels the PaymentIntent of an ended hold. If the money already arrived, runs the
 * late-payment path instead (confirm if the table is still free, else refund).
 */
export async function closeIntent(reservationId: string, paymentIntentId: string, source: "release" | "job"): Promise<string> {
  const res = await payments().cancelPaymentIntent(paymentIntentId);
  if (res.canceled || res.intent.status === "canceled") {
    await db()
      .update(reservation)
      .set({ paymentIntentCanceledAt: new Date(), updatedAt: new Date() })
      .where(and(eq(reservation.id, reservationId), ne(reservation.status, "held")));
    return "intent_canceled";
  }
  if (res.intent.status === "succeeded") {
    const r = await confirmPayment(paymentIntentId, res.intent.card, source === "job" ? "job" : "poll");
    return r.outcome;
  }
  return `intent_${res.intent.status}`;
}
