import "server-only";
import { db, type Queryable } from "@/db/client";
import { auditLog } from "@/db/schema";

/** Who did something: a guest (through their manage link), an operator, or the system itself. */
export interface Actor {
  type: "guest" | "operator" | "system";
  id: string | null;
}

export const SYSTEM: Actor = { type: "system", id: null };

/**
 * One audit row per state change or money movement (PRD privacy controls: refunds and
 * cancellations are written to the audit log). Details hold ids and amounts, never
 * guest contact data.
 */
export async function audit(
  entry: {
    venueId: string;
    actor: Actor;
    action: string;
    reservationId: string | null;
    amountCents?: number | null;
    details?: Record<string, unknown>;
  },
  q: Queryable = db(),
): Promise<void> {
  await q.insert(auditLog).values({
    venueId: entry.venueId,
    actorType: entry.actor.type,
    actorId: entry.actor.id,
    action: entry.action,
    reservationId: entry.reservationId,
    amountCents: entry.amountCents ?? null,
    details: entry.details ?? {},
  });
}
