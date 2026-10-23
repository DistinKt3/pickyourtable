import "server-only";
import { and, asc, eq, gt, inArray, lt, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { blackout, guest, reservation, venueTable } from "@/db/schema";
import type { BlackoutView } from "@/lib/api/contracts";
import type { OperatorSession } from "@/lib/auth/session";
import { ApiError } from "@/lib/http/api";
import { audit } from "./audit";
import type { OverlappingBooking } from "./schemas";
import { END_OF_DAY, localDayRange, localToUtc, utcToLocal } from "./time";

/**
 * Blackouts (PRD O-4): block one table or the whole venue for a time range on one
 * date. Times arrive in the venue's time zone and are stored as UTC instants.
 * Guest availability reads this table directly, so a blocked table shows as taken
 * on the next availability poll (well inside the PRD's 10 seconds).
 */

export interface BlackoutInput {
  table: string | null;
  date: string;
  from: string;
  to: string;
  reason: string;
}

/** The UTC instants for a local range. "23:59" means the end of the day. */
export function blackoutInstants(date: string, from: string, to: string, timeZone: string): { startsAt: Date; endsAt: Date } {
  const startsAt = localToUtc(date, from, timeZone);
  const endsAt = to === END_OF_DAY ? localDayRange(date, timeZone).end : localToUtc(date, to, timeZone);
  return { startsAt, endsAt };
}

function toView(
  r: { id: string; startsAt: Date; endsAt: Date; reason: string; code: string | null; label: string | null },
  timeZone: string,
): BlackoutView {
  const start = utcToLocal(r.startsAt, timeZone);
  const end = utcToLocal(r.endsAt, timeZone);
  const endsNextDay = end.date > start.date;
  return {
    id: r.id,
    table: r.code,
    tableLabel: r.label,
    date: start.date,
    from: start.time,
    to: endsNextDay ? END_OF_DAY : end.time,
    startsAt: r.startsAt.toISOString(),
    endsAt: r.endsAt.toISOString(),
    reason: r.reason,
  };
}

const viewColumns = {
  id: blackout.id,
  startsAt: blackout.startsAt,
  endsAt: blackout.endsAt,
  reason: blackout.reason,
  code: venueTable.code,
  label: venueTable.label,
};

/** Blackouts that end on or after `from` (a local date), and start before the end of `to`. */
export async function listBlackouts(
  venueId: string,
  timeZone: string,
  range: { from: string; to?: string },
): Promise<BlackoutView[]> {
  const after = localDayRange(range.from, timeZone).start;
  const before = range.to ? localDayRange(range.to, timeZone).end : null;
  const rows = await db()
    .select(viewColumns)
    .from(blackout)
    .leftJoin(venueTable, eq(venueTable.id, blackout.tableId))
    .where(and(eq(blackout.venueId, venueId), gt(blackout.endsAt, after), before ? lt(blackout.startsAt, before) : undefined))
    .orderBy(asc(blackout.startsAt), asc(venueTable.sort));
  return rows.map((r) => toView(r, timeZone));
}

async function tableId(venueId: string, code: string | null): Promise<{ id: string; label: string } | null> {
  if (!code) return null;
  const [row] = await db()
    .select({ id: venueTable.id, label: venueTable.label })
    .from(venueTable)
    .where(and(eq(venueTable.venueId, venueId), eq(venueTable.code, code)));
  if (!row) throw new ApiError(404, "table_not_found", "That table is not in this venue.");
  return row;
}

/** Confirmed bookings inside a range: the warning shown before and after blocking it. */
export async function overlappingBookings(
  venueId: string,
  timeZone: string,
  range: { table: string | null; startsAt: Date; endsAt: Date },
): Promise<OverlappingBooking[]> {
  const table = await tableId(venueId, range.table);
  const rows = await db()
    .select({
      id: reservation.id,
      startsAt: reservation.startsAt,
      partySize: reservation.partySize,
      priceCents: reservation.priceCents,
      code: venueTable.code,
      label: venueTable.label,
      guestName: guest.name,
    })
    .from(reservation)
    .innerJoin(venueTable, eq(venueTable.id, reservation.tableId))
    .leftJoin(guest, eq(guest.id, reservation.guestId))
    .where(
      and(
        eq(reservation.venueId, venueId),
        inArray(reservation.status, ["confirmed"]),
        table ? eq(reservation.tableId, table.id) : undefined,
        sql`${reservation.during} && tstzrange(${range.startsAt.toISOString()}::timestamptz, ${range.endsAt.toISOString()}::timestamptz, '[)')`,
      ),
    )
    .orderBy(asc(reservation.startsAt), asc(venueTable.sort));
  return rows.map((r) => {
    const local = utcToLocal(r.startsAt, timeZone);
    return {
      id: r.id,
      table: r.code,
      tableLabel: r.label,
      date: local.date,
      time: local.time,
      guestName: r.guestName ?? "Guest",
      partySize: r.partySize,
      priceCents: r.priceCents,
    };
  });
}

export async function createBlackout(
  op: OperatorSession,
  timeZone: string,
  input: BlackoutInput,
): Promise<{ blackout: BlackoutView; overlapping: OverlappingBooking[] }> {
  const table = await tableId(op.venueId, input.table);
  const { startsAt, endsAt } = blackoutInstants(input.date, input.from, input.to, timeZone);
  if (endsAt.getTime() <= Date.now()) throw new ApiError(422, "in_the_past", "That time has already passed.");
  const overlapping = await overlappingBookings(op.venueId, timeZone, { table: input.table, startsAt, endsAt });
  const id = await db().transaction(async (tx) => {
    const [row] = await tx
      .insert(blackout)
      .values({
        venueId: op.venueId,
        tableId: table?.id ?? null,
        startsAt,
        endsAt,
        reason: input.reason,
        createdBy: op.operatorId,
      })
      .returning({ id: blackout.id });
    await audit(tx, op, "blackout.created", {
      blackout: row!.id,
      table: input.table,
      date: input.date,
      from: input.from,
      to: input.to,
      startsAt: startsAt.toISOString(),
      endsAt: endsAt.toISOString(),
      reason: input.reason,
      overlappingBookings: overlapping.map((b) => b.id),
    });
    return row!.id;
  });
  const view = toView({ id, startsAt, endsAt, reason: input.reason, code: input.table, label: table?.label ?? null }, timeZone);
  return { blackout: view, overlapping };
}

export async function deleteBlackout(op: OperatorSession, timeZone: string, id: string): Promise<void> {
  await db().transaction(async (tx) => {
    const [row] = await tx
      .select(viewColumns)
      .from(blackout)
      .leftJoin(venueTable, eq(venueTable.id, blackout.tableId))
      .where(and(eq(blackout.id, id), eq(blackout.venueId, op.venueId)));
    if (!row) throw new ApiError(404, "blackout_not_found", "That blackout is not in this venue.");
    await tx.delete(blackout).where(eq(blackout.id, id));
    const view = toView(row, timeZone);
    await audit(tx, op, "blackout.deleted", {
      blackout: id,
      table: view.table,
      date: view.date,
      from: view.from,
      to: view.to,
      reason: view.reason,
    });
  });
}
