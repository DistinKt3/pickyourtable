import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { magicLink, operator, venue } from "@/db/schema";
import { issueMagicLink, normalizeEmail } from "@/lib/auth/session";
import { sendEmail } from "@/lib/email/index";
import { env } from "@/lib/env";
import { log } from "@/lib/log";
import { sha256 } from "@/lib/security/crypto";
import { loadVenue } from "@/lib/venue/load";
import { signInEmail } from "./emails";

export const SIGN_IN_PATH = "/portal/sign-in";
export const HOME_PATH = "/portal/tonight";

/**
 * Sends a sign-in link if the email belongs to an active operator. Callers run this
 * after the response so that known and unknown emails get the same answer in the
 * same time; it never reports which happened.
 */
export async function sendSignInLink(email: string): Promise<void> {
  const issued = await issueMagicLink(normalizeEmail(email));
  if (!issued) {
    log.info("portal.sign_in_requested", { known: false });
    return;
  }
  const op = issued.operator;
  const [row] = await db().select({ name: venue.name }).from(venue).where(eq(venue.id, op.venueId));
  const config = await loadVenue(op.venueId).catch(() => null);
  const url = new URL("/portal/auth", env().APP_URL);
  url.searchParams.set("token", issued.token);
  const mail = signInEmail({
    venueName: row?.name ?? config?.name ?? "your venue",
    operatorName: op.name,
    url: url.toString(),
    accent: config?.brand.accent,
    onAccent: config?.brand.onAccent,
  });
  await sendEmail({ to: op.email, subject: mail.subject, html: mail.html, text: mail.text, tag: "portal-sign-in" });
  log.info("portal.sign_in_requested", { known: true, operatorId: op.id, venueId: op.venueId });
}

export type LinkState =
  | { state: "valid"; venueName: string; email: string }
  | { state: "expired" | "used" | "invalid"; venueName: string | null };

/**
 * Looks at a sign-in link without using it, so the page can explain an expired or
 * used link before anyone presses Sign in. Reading never redeems: mail scanners
 * that prefetch the link cannot spend it.
 */
export async function inspectSignInLink(token: string | undefined): Promise<LinkState> {
  if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return { state: "invalid", venueName: null };
  const rows = await db()
    .select({
      expiresAt: magicLink.expiresAt,
      usedAt: magicLink.usedAt,
      email: operator.email,
      disabledAt: operator.disabledAt,
      venueName: venue.name,
    })
    .from(magicLink)
    .innerJoin(operator, eq(operator.id, magicLink.operatorId))
    .innerJoin(venue, eq(venue.id, operator.venueId))
    .where(eq(magicLink.tokenHash, sha256(token)));
  const row = rows[0];
  if (!row || row.disabledAt) return { state: "invalid", venueName: null };
  if (row.usedAt) return { state: "used", venueName: row.venueName };
  if (row.expiresAt.getTime() <= Date.now()) return { state: "expired", venueName: row.venueName };
  return { state: "valid", venueName: row.venueName, email: row.email };
}
