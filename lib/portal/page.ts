import "server-only";
import { redirect } from "next/navigation";
import { cache } from "react";
import type { OperatorRole } from "@/db/schema";
import { currentOperator, type OperatorSession } from "@/lib/auth/session";
import { type PortalVenue, portalVenue } from "./venue";

/**
 * For portal pages (server components). Every page and the portal layout call this:
 * no session sends the visitor to sign-in; a role that may not see the page gets
 * `allowed: false` and the page explains who can. One lookup per request.
 */

const signedIn = cache(async (): Promise<{ op: OperatorSession; venue: PortalVenue } | null> => {
  const op = await currentOperator();
  if (!op) return null;
  return { op, venue: await portalVenue(op.venueId) };
});

export async function portalPage(
  roles: OperatorRole[] = ["owner", "host"],
): Promise<{ op: OperatorSession; venue: PortalVenue; allowed: boolean }> {
  const found = await signedIn();
  if (!found) redirect("/portal/sign-in");
  return { ...found, allowed: roles.includes(found.op.role) };
}

export const ROLE_LABEL: Record<OperatorRole, string> = { owner: "Owner", host: "Host" };
