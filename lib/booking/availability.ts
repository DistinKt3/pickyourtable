import "server-only";
import { sql } from "drizzle-orm";
import { db, type Queryable } from "@/db/client";
import type { AlternativeTime, TableAvailability, TableSuggestion } from "@/lib/api/contracts";
import type { BookingTable, BookingVenue } from "./context";
import { priceFor } from "./pricing";
import { mostSimilar, type SimilarCandidate } from "./similar";
import { daySlots, maxTurnMinutes, type Slot, slotEnd, slotProblem, turnMinutes } from "./slots";

/**
 * Availability (PRD G-2, O-4, "Availability truth"). A table is free for a slot when it
 * is bookable, the party fits, and nothing overlaps [start, start + turn time): no
 * confirmed or seated booking, no unexpired hold, and no blackout for the table or the
 * whole venue. Guests see blackouts as taken.
 *
 * The day's reservations and blackouts are loaded once, in one query, and every slot of
 * the day is answered from memory.
 */

export interface Busy {
  /** Null for a blackout that covers every table. */
  tableId: string | null;
  start: number;
  end: number;
}

/** Everything that blocks a table between `from` and `to`. */
export async function loadBusy(
  venueId: string,
  from: Date,
  to: Date,
  opts: { tableId?: string; q?: Queryable } = {},
): Promise<Busy[]> {
  const q = opts.q ?? db();
  const range = sql`tstzrange(${from.toISOString()}::timestamptz, ${to.toISOString()}::timestamptz, '[)')`;
  const tableFilter = opts.tableId ? sql`AND table_id = ${opts.tableId}` : sql``;
  const blackoutFilter = opts.tableId ? sql`AND (table_id = ${opts.tableId} OR table_id IS NULL)` : sql``;
  const res = await q.execute<{ table_id: string | null; starts_at: Date | string; ends_at: Date | string }>(sql`
    SELECT table_id, starts_at, ends_at FROM reservation
     WHERE venue_id = ${venueId} AND during && ${range} ${tableFilter}
       AND (status IN ('confirmed', 'seated') OR (status = 'held' AND hold_expires_at > now()))
    UNION ALL
    SELECT table_id, starts_at, ends_at FROM blackout
     WHERE venue_id = ${venueId} AND during && ${range} ${blackoutFilter}
  `);
  return res.rows.map((r) => ({
    tableId: r.table_id,
    start: new Date(r.starts_at).getTime(),
    end: new Date(r.ends_at).getTime(),
  }));
}

export function isBusy(busy: readonly Busy[], tableId: string, start: number, end: number): boolean {
  for (const b of busy) {
    if ((b.tableId === null || b.tableId === tableId) && b.start < end && start < b.end) return true;
  }
  return false;
}

/** The time window a date's slots can touch: first start to last start plus the longest turn. */
export function dayWindow(v: BookingVenue, date: string): { from: Date; to: Date } | null {
  const slots = daySlots(v.slots, date);
  if (!slots.length) return null;
  return { from: slots[0]!.startsAt, to: slotEnd(slots.at(-1)!.startsAt, maxTurnMinutes(v.turnTimes)) };
}

export function fitsParty(t: Pick<BookingTable, "minParty" | "maxParty">, party: number): boolean {
  return party >= t.minParty && party <= t.maxParty;
}

export function wrongSizeReason(t: Pick<BookingTable, "minParty" | "maxParty">, party: number): string {
  const yours = `Your party is ${party}.`;
  if (party > t.maxParty) return `Seats ${t.maxParty}. ${yours}`;
  return t.minParty === t.maxParty ? `Seats ${t.maxParty}. ${yours}` : `For ${t.minParty} to ${t.maxParty} guests. ${yours}`;
}

export const NOT_BOOKABLE_REASON = "The host seats this table on arrival.";
export const TAKEN_REASON = "Booked at this time.";

export interface TableAnswer extends TableAvailability {
  table: BookingTable;
}

/** The state of every table for one slot and party. */
export function tablesForSlot(v: BookingVenue, slot: Slot, party: number, busy: readonly Busy[]): TableAnswer[] {
  const turn = turnMinutes(v.turnTimes, party);
  const start = slot.startsAt.getTime();
  const end = turn === null ? start : slotEnd(slot.startsAt, turn).getTime();
  return v.tables.map((t) => {
    const price = t.bookable
      ? priceFor(v.rules, v.slots.weekendDays, { tier: t.tier, daypart: slot.daypart, date: slot.date })
      : null;
    if (!t.bookable || !price)
      return { table: t, code: t.code, state: "not_bookable", feeCents: null, reason: NOT_BOOKABLE_REASON };
    if (turn === null || !fitsParty(t, party)) {
      return { table: t, code: t.code, state: "wrong_size", feeCents: price.feeCents, reason: wrongSizeReason(t, party) };
    }
    if (isBusy(busy, t.id, start, end))
      return { table: t, code: t.code, state: "taken", feeCents: price.feeCents, reason: TAKEN_REASON };
    return { table: t, code: t.code, state: "available", feeCents: price.feeCents, reason: null };
  });
}

/**
 * For each bookable tier with no free table in the slot (and at least one table that
 * fits the party), the 3 start times nearest to it on the same date that have a free
 * table of that tier, in time order.
 */
export function alternativesFor(
  v: BookingVenue,
  slot: Slot,
  party: number,
  answers: readonly TableAnswer[],
  busy: readonly Busy[],
  now: Date,
): Record<string, AlternativeTime[]> {
  const tiers = new Map<string, { fits: boolean; free: boolean }>();
  for (const a of answers) {
    if (a.state === "not_bookable") continue;
    const cur = tiers.get(a.table.tier) ?? { fits: false, free: false };
    if (a.state !== "wrong_size") cur.fits = true;
    if (a.state === "available") cur.free = true;
    tiers.set(a.table.tier, cur);
  }
  const wanted = [...tiers].filter(([, s]) => s.fits && !s.free).map(([tier]) => tier);
  if (!wanted.length) return {};

  const others = daySlots(v.slots, slot.date).filter(
    (s) => s.startsAt.getTime() !== slot.startsAt.getTime() && slotProblem(v.slots, s, now) === null,
  );
  const perSlot = others.map((s) => ({ s, answers: tablesForSlot(v, s, party, busy) }));
  const out: Record<string, AlternativeTime[]> = {};
  for (const tier of wanted) {
    const options = perSlot
      .map(({ s, answers: list }) => ({
        s,
        tables: list.filter((a) => a.table.tier === tier && a.state === "available").map((a) => a.code),
      }))
      .filter((o) => o.tables.length > 0)
      .sort(
        (a, b) =>
          Math.abs(a.s.startsAt.getTime() - slot.startsAt.getTime()) -
            Math.abs(b.s.startsAt.getTime() - slot.startsAt.getTime()) || a.s.startsAt.getTime() - b.s.startsAt.getTime(),
      )
      .slice(0, 3)
      .sort((a, b) => a.s.startsAt.getTime() - b.s.startsAt.getTime());
    out[tier] = options.map((o) => ({ date: o.s.date, time: o.s.time, startsAt: o.s.startsAt.toISOString(), tables: o.tables }));
  }
  return out;
}

/** The most similar free table to `code` in this slot, for a guest who just lost it. */
export function similarFreeTable(v: BookingVenue, code: string, answers: readonly TableAnswer[]): TableSuggestion | null {
  const target = answers.find((a) => a.code === code);
  if (!target) return null;
  const toCandidate = (a: TableAnswer): SimilarCandidate => ({
    code: a.code,
    label: a.table.label,
    tier: a.table.tier,
    attributes: a.table.attributes,
    x: a.table.x,
    z: a.table.z,
    feeCents: a.feeCents ?? 0,
  });
  return mostSimilar(toCandidate(target), answers.filter((a) => a.state === "available" && a.code !== code).map(toCandidate));
}
