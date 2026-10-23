import "server-only";
import { redirect } from "next/navigation";
import type { OperatorRole } from "@/db/schema";
import { currentOperator, type OperatorSession } from "@/lib/auth/session";
import { type PortalVenue, portalVenue } from "./venue";

/**
 * For portal pages (server components). Every page calls this: no session sends the
 * visitor to sign-in; a role that may not see the page gets `allowed: false` and the
 * page explains who can.
 */
export async function portalPage(
  roles: OperatorRole[] = ["owner", "host"],
): Promise<{ op: OperatorSession; venue: PortalVenue; allowed: boolean }> {
  const op = await currentOperator();
  if (!op) redirect("/portal/sign-in");
  const venue = await portalVenue(op.venueId);
  return { op, venue, allowed: roles.includes(op.role) };
}

export const ROLE_LABEL: Record<OperatorRole, string> = { owner: "Owner", host: "Host" };
