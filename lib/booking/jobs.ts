import "server-only";
import { and, asc, eq, gte, isNotNull, isNull, or, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { reservation, venue } from "@/db/schema";
import { log } from "@/lib/log";
import { payments } from "@/lib/payments";
import { pruneRateLimits } from "@/lib/security/rate-limit";
import { closeIntent } from "./holds";
import { settleRefund } from "./refunds";

/**
 * Scheduled work. `tick` runs every 30 seconds (PRD: "A job every 30 s expires unpaid
 * holds"); `reconcile` nightly; `retention` daily.
 */

const BATCH = 50;

export interface TickReport {
  expired: number;
  intentsClosed: number;
  latePayments: number;
  refundsSettled: number;
  rateLimitsPruned: number;
}

export async function tick(): Promise<TickReport> {
  const report: TickReport = { expired: 0, intentsClosed: 0, latePayments: 0, refundsSettled: 0, rateLimitsPruned: 0 };

  // 1. Unpaid holds past their expiry release their table.
  const expired = await db()
    .update(reservation)
    .set({ status: "expired", cancelReason: "expired", updatedAt: new Date() })
    .where(and(eq(reservation.status, "held"), sql`${reservation.holdExpiresAt} <= now()`))
    .returning({
      id: reservation.id,
      venueId: reservation.venueId,
      paymentIntentId: reservation.paymentIntentId,
      priceCents: reservation.priceCents,
    });
  report.expired = expired.length;
  for (const r of expired) {
    log.info("hold.expired", {
      holdId: r.id,
      venueId: r.venueId,
      paymentIntentId: r.paymentIntentId,
      priceCents: r.priceCents,
      outcome: "expired",
    });
  }

  // 2. Their PaymentIntents are cancelled; one that already succeeded takes the late-payment path.
  const open = await db()
    .select({ id: reservation.id, paymentIntentId: reservation.paymentIntentId })
    .from(reservation)
    .where(
      and(
        eq(reservation.status, "expired"),
        isNotNull(reservation.paymentIntentId),
        isNull(reservation.paymentIntentCanceledAt),
        isNull(reservation.confirmedAt),
        eq(reservation.refundDueCents, 0),
      ),
    )
    .orderBy(asc(reservation.holdExpiresAt))
    .limit(BATCH);
  for (const r of open) {
    try {
      const outcome = await closeIntent(r.id, r.paymentIntentId!, "job");
      if (outcome === "intent_canceled") report.intentsClosed++;
      else if (outcome === "confirmed" || outcome === "confirmed_late" || outcome === "refunded_late") report.latePayments++;
    } catch (e) {
      log.error("job.close_intent_failed", { reservationId: r.id, paymentIntentId: r.paymentIntentId, error: e });
    }
  }

  // 3. Refunds owed but not yet confirmed by the provider are retried.
  const owed = await db()
    .select({ id: reservation.id })
    .from(reservation)
    .where(sql`${reservation.refundDueCents} > ${reservation.refundCents}`)
    .orderBy(asc(reservation.updatedAt))
    .limit(BATCH);
  for (const r of owed) {
    const res = await settleRefund(r.id);
    if (res.ok && res.refundedCents > 0) report.refundsSettled++;
  }

  report.rateLimitsPruned = await pruneRateLimits();
  return report;
}

export interface Mismatch {
  reservationId: string;
  paymentIntentId: string | null;
  kind:
    | "provider_error"
    | "not_charged"
    | "amount"
    | "application_fee"
    | "destination"
    | "refund_amount"
    | "refund_pending"
    | "paid_without_booking";
  expected: number | string | null;
  actual: number | string | null;
}

export interface ReconcileReport {
  checked: number;
  mismatches: Mismatch[];
  chargedCents: number;
  refundedCents: number;
  netCents: number;
}

/**
 * Compares every reservation that touched money with the provider: the charge amount,
 * the application fee, the destination account and the refunds, to the cent. Every
 * mismatch is logged. Covers bookings starting in the last 45 days or later, and
 * anything changed in the last 2 days.
 */
export async function reconcile(opts: { since?: Date } = {}): Promise<ReconcileReport> {
  const since = opts.since ?? new Date(Date.now() - 45 * 86_400_000);
  const rows = await db()
    .select({ r: reservation, destination: venue.stripeAccountId })
    .from(reservation)
    .innerJoin(venue, eq(venue.id, reservation.venueId))
    .where(
      and(
        isNotNull(reservation.paymentIntentId),
        or(gte(reservation.startsAt, since), gte(reservation.updatedAt, new Date(Date.now() - 2 * 86_400_000))),
      ),
    )
    .orderBy(asc(reservation.createdAt));

  const provider = payments();
  const report: ReconcileReport = { checked: 0, mismatches: [], chargedCents: 0, refundedCents: 0, netCents: 0 };
  const miss = (m: Mismatch) => {
    report.mismatches.push(m);
    log.warn("reconcile.mismatch", { ...m });
  };

  for (const { r, destination } of rows) {
    report.checked++;
    const pi = r.paymentIntentId!;
    let intent;
    let refunds;
    try {
      intent = await provider.retrievePaymentIntent(pi);
      refunds = await provider.listRefunds(pi);
    } catch (e) {
      miss({
        reservationId: r.id,
        paymentIntentId: pi,
        kind: "provider_error",
        expected: null,
        actual: e instanceof Error ? e.message : String(e),
      });
      continue;
    }
    const refunded = refunds.filter((x) => x.status === "succeeded" || x.status === "pending").reduce((s, x) => s + x.amount, 0);
    const paid = r.confirmedAt !== null || r.refundDueCents > 0;

    if (paid) {
      if (intent.status !== "succeeded")
        miss({ reservationId: r.id, paymentIntentId: pi, kind: "not_charged", expected: "succeeded", actual: intent.status });
      if (intent.amount !== r.priceCents || intent.amountReceived !== r.priceCents) {
        miss({ reservationId: r.id, paymentIntentId: pi, kind: "amount", expected: r.priceCents, actual: intent.amountReceived });
      }
      if (intent.applicationFeeAmount !== r.applicationFeeCents) {
        miss({
          reservationId: r.id,
          paymentIntentId: pi,
          kind: "application_fee",
          expected: r.applicationFeeCents,
          actual: intent.applicationFeeAmount,
        });
      }
      if (destination && intent.destination !== destination) {
        miss({
          reservationId: r.id,
          paymentIntentId: pi,
          kind: "destination",
          expected: destination,
          actual: intent.destination,
        });
      }
      if (refunded !== r.refundCents)
        miss({ reservationId: r.id, paymentIntentId: pi, kind: "refund_amount", expected: r.refundCents, actual: refunded });
      if (r.refundCents !== r.refundDueCents) {
        miss({
          reservationId: r.id,
          paymentIntentId: pi,
          kind: "refund_pending",
          expected: r.refundDueCents,
          actual: r.refundCents,
        });
      }
      report.chargedCents += intent.amountReceived;
      report.refundedCents += refunded;
    } else if (intent.status === "succeeded" || refunded > 0) {
      // Money moved for a hold that is neither a booking nor refunded.
      miss({
        reservationId: r.id,
        paymentIntentId: pi,
        kind: "paid_without_booking",
        expected: 0,
        actual: intent.amountReceived - refunded,
      });
    }
  }
  report.netCents = report.chargedCents - report.refundedCents;
  log.info("reconcile.done", {
    checked: report.checked,
    mismatches: report.mismatches.length,
    chargedCents: report.chargedCents,
    refundedCents: report.refundedCents,
    netCents: report.netCents,
    outcome: report.mismatches.length ? "mismatch" : "ok",
  });
  return report;
}

export interface RetentionReport {
  guestsDeleted: number;
  emailsDeleted: number;
  reservationsScrubbed: number;
}

export const RETENTION_MONTHS = 24;

/** Deletes guest data 24 months after the visit (PRD privacy table). Bookings keep their amounts for the books. */
export async function retention(): Promise<RetentionReport> {
  return db().transaction(async (tx) => {
    const cutoff = sql`now() - make_interval(months => ${RETENTION_MONTHS}::int)`;
    const old = await tx.execute<{ id: string; guest_id: string | null }>(sql`
      SELECT id, guest_id FROM reservation
       WHERE ends_at < ${cutoff} AND (guest_id IS NOT NULL OR email_norm IS NOT NULL)
    `);
    const ids = old.rows.map((r) => r.id);
    const guestIds = [...new Set(old.rows.map((r) => r.guest_id).filter((g): g is string => Boolean(g)))];
    if (!ids.length) return { guestsDeleted: 0, emailsDeleted: 0, reservationsScrubbed: 0 };

    const idList = sql.join(
      ids.map((i) => sql`${i}::uuid`),
      sql`, `,
    );
    const emails = await tx.execute(sql`DELETE FROM email_message WHERE reservation_id IN (${idList})`);
    const scrubbed = await tx.execute(
      sql`UPDATE reservation SET email_norm = NULL, guest_id = NULL, updated_at = now() WHERE id IN (${idList})`,
    );
    let guests = 0;
    if (guestIds.length) {
      // A guest row is kept while any booking within the retention period still points at it.
      const res = await tx.execute(sql`
        DELETE FROM guest g
         WHERE g.id IN (${sql.join(
           guestIds.map((i) => sql`${i}::uuid`),
           sql`, `,
         )})
           AND NOT EXISTS (SELECT 1 FROM reservation r WHERE r.guest_id = g.id)
      `);
      guests = res.rowCount ?? 0;
    }
    const report = { guestsDeleted: guests, emailsDeleted: emails.rowCount ?? 0, reservationsScrubbed: scrubbed.rowCount ?? 0 };
    log.info("retention.done", { ...report, outcome: "ok" });
    return report;
  });
}
