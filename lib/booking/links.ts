import "server-only";
import { env } from "@/lib/env";
import { addDays } from "@/lib/format";
import { signToken } from "@/lib/security/tokens";
import { localDateTime, startOfLocalDay } from "./time";

/**
 * Guest links. A manage link carries a signed token bound to one reservation and its
 * current nonce, valid until the end of the visit date in the venue's time zone (PRD
 * privacy controls). The token alone identifies the booking.
 */

/** The end of the visit's local date: the first instant of the next day. */
export function visitEnd(startsAt: Date, timeZone: string): Date {
  const { date } = localDateTime(startsAt, timeZone);
  return startOfLocalDay(addDays(date, 1), timeZone);
}

export async function manageToken(r: { id: string; manageNonce: string; startsAt: Date }, timeZone: string): Promise<string> {
  return signToken("manage", { sub: r.id, nonce: r.manageNonce, expiresAt: visitEnd(r.startsAt, timeZone) });
}

export function manageUrl(venueId: string, token: string): string {
  return new URL(`/v/${venueId}/manage/${token}`, env().APP_URL).toString();
}

/** Same-origin path to the booking's calendar file. */
export function calendarPath(token: string): string {
  return `/api/manage/${token}/calendar`;
}

export function venueUrl(venueId: string): string {
  return new URL(`/v/${venueId}`, env().APP_URL).toString();
}

export function absoluteUrl(path: string): string {
  return new URL(path, env().APP_URL).toString();
}

export const HOLD_TOKEN_GRACE_MINUTES = 20;

export async function holdToken(r: { id: string; holdExpiresAt: Date | null }): Promise<string> {
  const base = r.holdExpiresAt ?? new Date();
  return signToken("hold", { sub: r.id, expiresAt: new Date(base.getTime() + HOLD_TOKEN_GRACE_MINUTES * 60_000) });
}
