import "server-only";
import { and, asc, desc, eq, gte, ilike, inArray, lt, lte, or, type SQL, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { guest, reservation, type ReservationStatus, venueTable } from "@/db/schema";
import type { BookingsResponse, PortalReservation, TonightResponse } from "@/lib/api/contracts";
import { addDays, todayIn } from "@/lib/format";
import { log } from "@/lib/log";
import { type Actor, audit } from "./audit";
import { type BookingVenue, loadBookingVenue } from "./context";
import { type LoadedBooking, loadBooking } from "./load";
import { sendBookingCancelled, sendBookingConfirmed, sendSeatedElsewhere } from "./notify";
import { settleRefund } from "./refunds";
import { daySlots } from "./slots";
import { localDateTime, startOfLocalDay } from "./time";
import { type GuestRow, portalReservationOf, type ReservationRow } from "./views";

/**
 * Reservation operations the operator portal calls. The booking service owns their
 * implementation (state machine, refunds, emails, audit log); portal route handlers
 * only authenticate, authorize and call these.
 *
 * Every function checks that the reservation belongs to `venueId`, so one venue's
 * operator can never act on another venue's booking.
 */

export type { Actor } from "./audit";

export interface ReservationResult {
  reservation: PortalReservation;
  refundCents: number;
}

export class OperationError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

const PAID: ReservationStatus[] = ["confirmed", "seated", "no_show"];
const NOT_FOUND = "We could not find this booking.";

async function venueOrThrow(venueId: string): Promise<BookingVenue> {
  const v = await loadBookingVenue(venueId);
  if (!v) throw new OperationError(404, "venue_not_found", "We could not find this venue.");
  return v;
}

/** A paid booking of this venue. Holds that were never paid are not bookings. */
async function bookingOf(venueId: string, reservationId: string): Promise<LoadedBooking> {
  const b = /^[0-9a-f-]{36}$/i.test(reservationId) ? await loadBooking(reservationId) : null;
  if (!b || b.r.venueId !== venueId || !b.r.confirmedAt) throw new OperationError(404, "not_found", NOT_FOUND);
  return b;
}

function stateError(status: ReservationStatus): OperationError {
  const messages: Partial<Record<ReservationStatus, string>> = {
    confirmed: "This guest has not been marked as arrived.",
    seated: "This guest is already seated.",
    no_show: "This booking is marked as a no-show.",
    cancelled: "This booking was cancelled.",
  };
  return new OperationError(409, "invalid_state", messages[status] ?? NOT_FOUND);
}

/**
 * Arrival is marked on the night. Seating is allowed from the start of the booking's
 * day at the venue (guests arrive early); a no-show only once the booking time has
 * passed, because it keeps the fee.
 */
function assertArrivalTime(b: LoadedBooking, action: "seat" | "no_show"): void {
  const now = new Date();
  if (action === "seat" && localDateTime(b.r.startsAt, b.v.timezone).date > todayIn(b.v.timezone)) {
    throw new OperationError(409, "too_early", "This booking is for a later date. Seat guests on the day.");
  }
  if (action === "no_show" && now < b.r.startsAt) {
    throw new OperationError(409, "too_early", "You can mark a no-show once the booking time has passed.");
  }
}

async function result(venueId: string, reservationId: string, refundCents: number, v?: BookingVenue): Promise<ReservationResult> {
  const b = await loadBooking(reservationId, v ? { venue: v } : {});
  if (!b) throw new OperationError(404, "not_found", NOT_FOUND);
  return { reservation: portalReservationOf(b.v, b.r, b.guest), refundCents };
}

/** A guarded transition: changes the row only if it is still in one of `from`, and writes the audit row with it. */
async function transition(
  b: LoadedBooking,
  from: ReservationStatus[],
  set: Partial<typeof reservation.$inferInsert>,
  entry: { actor: Actor; action: string; amountCents?: number | null; details?: Record<string, unknown> },
): Promise<ReservationRow> {
  return db().transaction(async (tx) => {
    const [row] = await tx
      .update(reservation)
      .set({ ...set, updatedAt: new Date() })
      .where(and(eq(reservation.id, b.r.id), eq(reservation.venueId, b.v.id), inArray(reservation.status, from)))
      .returning();
    if (!row) {
      const [now] = await tx.select({ status: reservation.status }).from(reservation).where(eq(reservation.id, b.r.id));
      throw stateError(now?.status ?? b.r.status);
    }
    await audit(
      {
        venueId: b.v.id,
        actor: entry.actor,
        action: entry.action,
        reservationId: b.r.id,
        amountCents: entry.amountCents ?? null,
        details: entry.details ?? {},
      },
      tx,
    );
    return row;
  });
}

function opLog(action: string, b: LoadedBooking, actor: Actor, fields: Record<string, unknown>) {
  log.info(action, {
    reservationId: b.r.id,
    venueId: b.v.id,
    actorType: actor.type,
    actorId: actor.id,
    priceCents: b.r.priceCents,
    ...fields,
  });
}

type TableState = TonightResponse["tables"][number]["state"];

/** Today's (or `date`'s) paid bookings and table states for the Tonight screen (PRD O-1). */
export async function listTonight(args: { venueId: string; date?: string }): Promise<TonightResponse> {
  const v = await venueOrThrow(args.venueId);
  const now = new Date();
  const today = todayIn(v.timezone, now);
  const date = args.date ?? today;
  const from = startOfLocalDay(date, v.timezone);
  const to = startOfLocalDay(addDays(date, 1), v.timezone);

  const rows = await db()
    .select({ r: reservation, g: guest })
    .from(reservation)
    .leftJoin(guest, eq(guest.id, reservation.guestId))
    .where(
      and(
        eq(reservation.venueId, v.id),
        gte(reservation.startsAt, from),
        lt(reservation.startsAt, to),
        inArray(reservation.status, PAID),
      ),
    )
    .orderBy(asc(reservation.startsAt), asc(reservation.createdAt));

  // Table states right now, or at the first service of another date.
  const at = date === today ? now : (daySlots(v.slots, date)[0]?.startsAt ?? from);
  const iso = at.toISOString();
  const covering = await db().execute<{
    kind: string;
    table_id: string | null;
    seated_table_id: string | null;
    status: string;
  }>(sql`
    SELECT 'reservation' AS kind, table_id, seated_table_id, status::text AS status FROM reservation
     WHERE venue_id = ${v.id} AND during @> ${iso}::timestamptz
       AND (status IN ('confirmed', 'seated') OR (status = 'held' AND hold_expires_at > now()))
    UNION ALL
    SELECT 'blackout' AS kind, table_id, NULL, 'blocked' FROM blackout
     WHERE venue_id = ${v.id} AND during @> ${iso}::timestamptz
  `);
  const rank: Record<TableState, number> = { seated: 4, paid: 3, held: 2, blocked: 1, free: 0 };
  const state = new Map<string, TableState>(v.tables.map((t) => [t.id, "free"]));
  const raise = (tableId: string, s: TableState) => {
    if (state.has(tableId) && rank[s] > rank[state.get(tableId)!]) state.set(tableId, s);
  };
  for (const c of covering.rows) {
    if (c.kind === "blackout") {
      if (c.table_id) raise(c.table_id, "blocked");
      else for (const t of v.tables) raise(t.id, "blocked");
    } else if (c.status === "seated") raise(c.seated_table_id ?? c.table_id!, "seated");
    else if (c.status === "confirmed") raise(c.table_id!, "paid");
    else raise(c.table_id!, "held");
  }

  return {
    venueId: v.id,
    date,
    generatedAt: now.toISOString(),
    reservations: rows.map(({ r, g }) => portalReservationOf(v, r, g as GuestRow | null)),
    tables: v.tables.map((t) => ({ code: t.code, state: state.get(t.id)! })),
  };
}

function likeEscape(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

export async function listBookings(args: {
  venueId: string;
  q?: string;
  status: "upcoming" | "past" | "cancelled" | "all";
  from?: string;
  to?: string;
}): Promise<BookingsResponse> {
  const v = await venueOrThrow(args.venueId);
  const now = new Date();
  const conds: (SQL | undefined)[] = [eq(reservation.venueId, v.id), sql`${reservation.confirmedAt} IS NOT NULL`];
  switch (args.status) {
    case "upcoming":
      conds.push(inArray(reservation.status, ["confirmed", "seated"]), gte(reservation.endsAt, now));
      break;
    case "past":
      conds.push(inArray(reservation.status, PAID), or(lte(reservation.endsAt, now), eq(reservation.status, "no_show")));
      break;
    case "cancelled":
      conds.push(eq(reservation.status, "cancelled"));
      break;
    case "all":
      conds.push(inArray(reservation.status, [...PAID, "cancelled"]));
      break;
  }
  if (args.from) conds.push(gte(reservation.startsAt, startOfLocalDay(args.from, v.timezone)));
  if (args.to) conds.push(lt(reservation.startsAt, startOfLocalDay(addDays(args.to, 1), v.timezone)));
  const q = args.q?.trim();
  if (q) {
    const pattern = `%${likeEscape(q)}%`;
    conds.push(
      or(
        ilike(guest.name, pattern),
        ilike(guest.email, pattern),
        ilike(venueTable.label, pattern),
        ilike(venueTable.code, pattern),
      ),
    );
  }
  const rows = await db()
    .select({ r: reservation, g: guest })
    .from(reservation)
    .innerJoin(venueTable, eq(venueTable.id, reservation.tableId))
    .leftJoin(guest, eq(guest.id, reservation.guestId))
    .where(and(...conds))
    .orderBy(args.status === "upcoming" ? asc(reservation.startsAt) : desc(reservation.startsAt))
    .limit(200);
  return { bookings: rows.map(({ r, g }) => portalReservationOf(v, r, g as GuestRow | null)) };
}

/**
 * Marks a confirmed booking seated. Seating at a different table than the one paid
 * for refunds the full fee automatically (PRD product decisions).
 */
export async function seatReservation(args: {
  venueId: string;
  reservationId: string;
  tableCode?: string;
  actor: Actor;
}): Promise<ReservationResult> {
  const b = await bookingOf(args.venueId, args.reservationId);
  if (b.r.status !== "confirmed") throw stateError(b.r.status);
  assertArrivalTime(b, "seat");
  const target = args.tableCode ? b.v.byCode.get(args.tableCode) : b.table;
  if (!target) throw new OperationError(404, "table_not_found", "We could not find that table.");
  const elsewhere = target.id !== b.table.id;
  const refund = elsewhere ? b.r.priceCents - b.r.refundDueCents : 0;

  await transition(
    b,
    ["confirmed"],
    {
      status: "seated",
      seatedAt: new Date(),
      seatedTableId: target.id,
      ...(elsewhere ? { refundDueCents: b.r.priceCents, cancelReason: "seated_elsewhere" } : {}),
    },
    {
      actor: args.actor,
      action: elsewhere ? "booking.seated_elsewhere" : "booking.seated",
      amountCents: elsewhere ? refund : null,
      details: { table: b.table.code, seatedTable: target.code },
    },
  );
  if (refund > 0) await settleRefund(b.r.id);
  opLog("booking.seated", b, args.actor, {
    table: b.table.code,
    seatedTable: target.code,
    refundCents: refund,
    outcome: elsewhere ? "seated_elsewhere" : "seated",
  });
  if (elsewhere) {
    const fresh = await loadBooking(b.r.id, { venue: b.v });
    if (fresh) await sendSeatedElsewhere(fresh, target.label);
  }
  return result(args.venueId, b.r.id, refund, b.v);
}

/** No-show: no refund (PRD refunds). */
export async function markNoShow(args: { venueId: string; reservationId: string; actor: Actor }): Promise<ReservationResult> {
  const b = await bookingOf(args.venueId, args.reservationId);
  if (b.r.status !== "confirmed") throw stateError(b.r.status);
  assertArrivalTime(b, "no_show");
  await transition(b, ["confirmed"], { status: "no_show" }, { actor: args.actor, action: "booking.no_show", amountCents: 0 });
  opLog("booking.no_show", b, args.actor, { refundCents: 0, outcome: "no_show" });
  return result(args.venueId, b.r.id, 0, b.v);
}

/** Puts a seated or no-show booking back to confirmed, when no refund has been issued. */
export async function undoArrival(args: { venueId: string; reservationId: string; actor: Actor }): Promise<ReservationResult> {
  const b = await bookingOf(args.venueId, args.reservationId);
  if (b.r.status !== "seated" && b.r.status !== "no_show") throw stateError(b.r.status);
  if (b.r.refundDueCents > 0) {
    throw new OperationError(
      409,
      "refund_issued",
      "This guest was refunded when they were seated at another table, so this cannot be undone.",
    );
  }
  await transition(
    b,
    ["seated", "no_show"],
    { status: "confirmed", seatedAt: null, seatedTableId: null },
    { actor: args.actor, action: "booking.arrival_undone", details: { from: b.r.status } },
  );
  opLog("booking.arrival_undone", b, args.actor, { from: b.r.status, outcome: "confirmed" });
  return result(args.venueId, b.r.id, 0, b.v);
}

/** Venue-initiated cancellation: full refund and an email to the guest (PRD O-2). */
export async function cancelByVenue(args: {
  venueId: string;
  reservationId: string;
  reason: string;
  actor: Actor;
}): Promise<ReservationResult> {
  const b = await bookingOf(args.venueId, args.reservationId);
  if (b.r.status !== "confirmed") throw stateError(b.r.status);
  const refund = b.r.priceCents - b.r.refundDueCents;
  await transition(
    b,
    ["confirmed"],
    { status: "cancelled", cancelledAt: new Date(), cancelReason: "venue", refundDueCents: b.r.priceCents },
    { actor: args.actor, action: "booking.cancelled", amountCents: refund, details: { by: "venue", reason: args.reason } },
  );
  if (refund > 0) await settleRefund(b.r.id);
  opLog("booking.cancelled", b, args.actor, { by: "venue", refundCents: refund, outcome: "full" });
  const fresh = await loadBooking(b.r.id, { venue: b.v });
  if (fresh) await sendBookingCancelled(fresh, { by: "venue", refundCents: refund });
  return result(args.venueId, b.r.id, refund, b.v);
}

export async function resendConfirmation(args: { venueId: string; reservationId: string; actor: Actor }): Promise<void> {
  const b = await bookingOf(args.venueId, args.reservationId);
  if (b.r.status !== "confirmed" && b.r.status !== "seated") throw stateError(b.r.status);
  const sent = await sendBookingConfirmed(b);
  if (!sent) throw new OperationError(502, "email_failed", "The confirmation could not be sent. Please try again.");
  await audit({ venueId: b.v.id, actor: args.actor, action: "confirmation.resent", reservationId: b.r.id });
  opLog("booking.confirmation_resent", b, args.actor, { outcome: "sent" });
}
