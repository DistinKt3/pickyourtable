import "server-only";
import type { NextRequest } from "next/server";
import type { OperatorRole } from "@/db/schema";
import { type OperatorSession, requireOperator } from "@/lib/auth/session";
import { tooMany } from "@/lib/http/api";
import { LIMITS, rateLimit } from "@/lib/security/rate-limit";

/**
 * Access rules for portal route handlers. Roles are enforced here on the server
 * (PRD privacy controls): refunds, venue cancellations, tables and pricing,
 * blackouts and venue review are Owner-only; Hosts view, seat, mark no-shows and
 * resend confirmations.
 */

export const OWNER: OperatorRole[] = ["owner"];
export const ANY_ROLE: OperatorRole[] = ["owner", "host"];

/** A read: the signed-in operator with one of `roles`, or 401/403. */
export function portalReader(req: NextRequest, roles: OperatorRole[] = ANY_ROLE): Promise<OperatorSession> {
  return requireOperator(req, roles);
}

/** A write: as a read, plus the per-operator write limit. */
export async function portalWriter(req: NextRequest, roles: OperatorRole[] = ANY_ROLE): Promise<OperatorSession> {
  const op = await requireOperator(req, roles);
  const limit = await rateLimit("portalWrite", op.operatorId, LIMITS.portalWrite);
  if (!limit.ok) throw tooMany(limit.retryAfterSeconds, "That was a lot of changes at once. Wait a moment and try again.");
  return op;
}
