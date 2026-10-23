import "server-only";
import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { auditLog, operator } from "@/db/schema";
import type { HistoryEntry } from "./schemas";

/**
 * A reservation's history for the Bookings detail: every audit row the booking
 * service wrote for it (payments, refunds, seating, cancellations), oldest first,
 * scoped to the operator's own venue.
 */

const LABELS: [RegExp, string][] = [
  [/refund/, "Refund"],
  [/cancel/, "Cancelled"],
  [/no_?show/, "Marked no-show"],
  [/undo|revert/, "Arrival undone"],
  [/seat/, "Seated"],
  [/resen[dt]|confirmation_sent/, "Confirmation resent"],
  [/confirm|paid|payment.succeeded/, "Booked and paid"],
  [/expire/, "Hold expired"],
  [/hold/, "Table held"],
];

export function historyLabel(action: string): string {
  const a = action.toLowerCase();
  for (const [re, label] of LABELS) if (re.test(a)) return label;
  const words = a.replace(/[._-]+/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export async function reservationHistory(venueId: string, reservationId: string): Promise<HistoryEntry[]> {
  const rows = await db()
    .select({
      action: auditLog.action,
      amountCents: auditLog.amountCents,
      actorType: auditLog.actorType,
      operatorName: operator.name,
      at: auditLog.createdAt,
    })
    .from(auditLog)
    .leftJoin(operator, sql`${auditLog.actorType} = 'operator' AND ${auditLog.actorId} = ${operator.id}::text`)
    .where(and(eq(auditLog.venueId, venueId), eq(auditLog.reservationId, reservationId)))
    .orderBy(asc(auditLog.createdAt), asc(auditLog.id));
  return rows.map((r) => ({
    action: r.action,
    label: historyLabel(r.action),
    amountCents: r.amountCents,
    actor: r.actorType === "operator" ? (r.operatorName ?? "Venue staff") : r.actorType === "guest" ? "Guest" : null,
    at: r.at.toISOString(),
  }));
}
