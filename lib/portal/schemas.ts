import { z } from "zod";
import { blackoutView, dateStr, iso, portalTable, priceRuleView, tableCode, timeStr, turnTimeView } from "@/lib/api/contracts";

/**
 * Portal responses that `lib/api/contracts.ts` leaves open: what each write returns.
 * Requests still use the shared contracts.
 */

/** POST /api/portal/auth/request. Always this answer, whether or not the email has an account. */
export const signInRequestResponse = z.object({ ok: z.literal(true) });

/** POST /api/portal/auth/redeem */
export const signInRedeemResponse = z.object({ ok: z.literal(true), next: z.string() });

/** PATCH /api/portal/tables/{code} and POST /api/portal/review/tables/{code} */
export const tableResponse = z.object({ table: portalTable });

/** PUT /api/portal/pricing/rules */
export const priceRuleResponse = z.object({ rule: priceRuleView });

/** PUT /api/portal/turn-times */
export const turnTimesResponse = z.object({ turnTimes: z.array(turnTimeView) });

/** A confirmed booking that a blackout would cover. Guests keep it; the owner decides. */
export const overlappingBooking = z.object({
  id: z.uuid(),
  table: tableCode,
  tableLabel: z.string(),
  date: dateStr,
  time: timeStr,
  guestName: z.string(),
  partySize: z.number().int(),
  priceCents: z.number().int(),
});
export type OverlappingBooking = z.infer<typeof overlappingBooking>;

/** POST /api/portal/blackouts */
export const createBlackoutResponse = z.object({ blackout: blackoutView, overlapping: z.array(overlappingBooking) });
export type CreateBlackoutResponse = z.infer<typeof createBlackoutResponse>;

/** GET /api/portal/blackouts/overlaps?table=&date=&from=&to= (owner): the warning shown before saving. */
export const overlapsQuery = z
  .object({ table: tableCode.optional(), date: dateStr, from: timeStr, to: timeStr })
  .refine((v) => v.from < v.to, "The end time must be after the start time");
export const overlapsResponse = z.object({ overlapping: z.array(overlappingBooking) });
export type OverlapsResponse = z.infer<typeof overlapsResponse>;

/** One audit entry for a reservation, shown as its history in Bookings. */
export const historyEntry = z.object({
  action: z.string(),
  label: z.string(),
  amountCents: z.number().int().nullable(),
  actor: z.string().nullable(),
  at: iso,
});
export type HistoryEntry = z.infer<typeof historyEntry>;

/** GET /api/portal/reservations/{id}/history */
export const historyResponse = z.object({ history: z.array(historyEntry) });

/** POST /api/portal/reservations/{id}/resend */
export const resendResponse = z.object({ ok: z.literal(true) });
