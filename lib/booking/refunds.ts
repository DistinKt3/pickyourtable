import "server-only";
import { eq, sql } from "drizzle-orm";
import { db, type Queryable } from "@/db/client";
import { reservation } from "@/db/schema";
import { log } from "@/lib/log";
import { payments } from "@/lib/payments";

/**
 * Refunds, written intent first. A state change records what the guest is owed
 * (`refund_due_cents`) in the same statement or transaction as the change itself; the
 * provider refund is requested afterwards, with no database locks held, under an
 * idempotency key derived from that amount. If the request fails, the 30-second job
 * retries it, and reconciliation reports any gap. No path can owe a refund and forget it.
 */

/**
 * Raises what the guest is owed to `totalCents` (capped at the price; never lowered).
 * Returns true when this call raised it, so only one caller sends the related email.
 */
export async function owe(
  reservationId: string,
  totalCents: number,
  extra: { cancelReason?: string } = {},
  q: Queryable = db(),
): Promise<boolean> {
  const res = await q.execute(sql`
    UPDATE reservation
       SET refund_due_cents = LEAST(price_cents, GREATEST(refund_due_cents, ${totalCents}::int)),
           cancel_reason = COALESCE(${extra.cancelReason ?? null}::text, cancel_reason),
           updated_at = now()
     WHERE id = ${reservationId} AND refund_due_cents < LEAST(price_cents, ${totalCents}::int)
     RETURNING id
  `);
  return (res.rowCount ?? 0) > 0;
}

export interface SettleResult {
  ok: boolean;
  /** Refunded by this call. */
  refundedCents: number;
  refundId: string | null;
}

/** Requests whatever is owed but not yet refunded, then records it. Safe to call again at any time. */
export async function settleRefund(
  reservationId: string,
  opts: { reason?: "requested_by_customer" } = {},
): Promise<SettleResult> {
  const [r] = await db().select().from(reservation).where(eq(reservation.id, reservationId));
  if (!r) return { ok: false, refundedCents: 0, refundId: null };
  const gap = r.refundDueCents - r.refundCents;
  if (gap <= 0) return { ok: true, refundedCents: 0, refundId: r.refundId };
  if (!r.paymentIntentId) {
    log.error("refund.failed", { reservationId, venueId: r.venueId, amountCents: gap, outcome: "no_payment" });
    return { ok: false, refundedCents: 0, refundId: null };
  }
  try {
    const refund = await payments().refund({
      paymentIntentId: r.paymentIntentId,
      amount: gap,
      ...(opts.reason ? { reason: opts.reason } : {}),
      metadata: { reservation_id: r.id, venue_id: r.venueId },
      idempotencyKey: `refund-${r.id}-${r.refundDueCents}`,
    });
    await db()
      .update(reservation)
      .set({
        refundCents: sql`GREATEST(${reservation.refundCents}, ${r.refundDueCents}::int)`,
        refundId: refund.id,
        refundedAt: sql`COALESCE(${reservation.refundedAt}, now())`,
        updatedAt: new Date(),
      })
      .where(eq(reservation.id, r.id));
    log.info("refund.issued", {
      reservationId: r.id,
      venueId: r.venueId,
      paymentIntentId: r.paymentIntentId,
      refundId: refund.id,
      amountCents: gap,
      totalRefundedCents: r.refundDueCents,
      reason: r.cancelReason,
      outcome: refund.status,
    });
    return { ok: true, refundedCents: gap, refundId: refund.id };
  } catch (e) {
    log.error("refund.failed", {
      reservationId: r.id,
      venueId: r.venueId,
      paymentIntentId: r.paymentIntentId,
      amountCents: gap,
      outcome: "provider_error",
      error: e,
    });
    return { ok: false, refundedCents: 0, refundId: null };
  }
}
