import "server-only";
import type { Queryable } from "@/db/client";
import { auditLog } from "@/db/schema";
import type { OperatorSession } from "@/lib/auth/session";

/**
 * Every portal change that is not a reservation operation (prices, tables,
 * blackouts, approvals, go-live) writes one audit row with the actor, the action
 * and what changed. Reservation operations are audited by the booking service.
 */

export type PortalAction =
  | "table.updated"
  | "price_rule.saved"
  | "price_rule.deleted"
  | "turn_times.saved"
  | "blackout.created"
  | "blackout.deleted"
  | "table.approved"
  | "table.unapproved"
  | "venue.went_live";

export async function audit(
  q: Queryable,
  op: Pick<OperatorSession, "venueId" | "operatorId">,
  action: PortalAction,
  details: Record<string, unknown>,
  amountCents: number | null = null,
): Promise<void> {
  await q.insert(auditLog).values({
    venueId: op.venueId,
    actorType: "operator",
    actorId: op.operatorId,
    action,
    amountCents,
    details,
  });
}
