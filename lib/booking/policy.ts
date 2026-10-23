import type { RefundPreview } from "@/lib/api/contracts";
import { formatDate, formatMoney, formatTime } from "@/lib/format";
import { localDateTime } from "./time";

/**
 * The guest refund policy (PRD product decisions): a full refund when cancelling at
 * least `fullRefundHours` (24) before the booking starts, none after that. Computed on
 * the server at request time, for the preview and again for the actual cancel.
 */

export interface PolicyInput {
  startsAt: Date;
  now: Date;
  priceCents: number;
  /** Already refunded or owed for this booking. */
  refundedCents: number;
  fullRefundHours: number;
}

export interface PolicyResult {
  policy: "full" | "none";
  amountCents: number;
  /** The last instant a cancel still refunds in full. */
  deadline: Date;
}

export function refundPolicy(p: PolicyInput): PolicyResult {
  const deadline = new Date(p.startsAt.getTime() - p.fullRefundHours * 3_600_000);
  const full = p.now.getTime() <= deadline.getTime();
  const remaining = Math.max(0, p.priceCents - p.refundedCents);
  return full ? { policy: "full", amountCents: remaining, deadline } : { policy: "none", amountCents: 0, deadline };
}

/** The preview shown before a guest confirms a cancel, in plain words. */
export function refundPreviewFor(p: PolicyInput & { timeZone: string }): RefundPreview {
  const r = refundPolicy(p);
  const fee = formatMoney(p.priceCents);
  if (r.policy === "full") {
    const { date, time } = localDateTime(r.deadline, p.timeZone);
    return {
      policy: "full",
      amountCents: r.amountCents,
      explanation: `Cancelling now refunds the full ${formatMoney(r.amountCents)}. Full refunds are available until ${formatTime(time)} on ${formatDate(date)}.`,
    };
  }
  return {
    policy: "none",
    amountCents: 0,
    explanation: `Your booking is less than ${p.fullRefundHours} hours away, so cancelling now does not refund the ${fee} table fee.`,
  };
}
