import "server-only";
import type { AvailabilityResponse, SlotsResponse, TableTimesResponse } from "@/lib/api/contracts";
import { addDays } from "@/lib/format";
import { ApiError } from "@/lib/http/api";
import { alternativesFor, dayWindow, fitsParty, isBusy, loadBusy, tablesForSlot, wrongSizeReason } from "./availability";
import type { BookingVenue } from "./context";
import { dayTypeOf, priceFor } from "./pricing";
import {
  bookableSlots,
  daySlots,
  findSlot,
  lastBookableDate,
  maxTurnMinutes,
  type Slot,
  slotEnd,
  slotProblem,
  slotProblemMessage,
  turnMinutes,
} from "./slots";
import { startOfLocalDay, zonedInstant } from "./time";
import { slotViewFromSlot } from "./views";

/** Guest reads: availability for one slot, free tables per time, and times for one table. */

/** The slot a guest asked for, or a 422 with the reason in plain words. */
export function resolveSlot(v: BookingVenue, date: string, time: string, now: Date): Slot {
  const slot = findSlot(v.slots, date, time);
  if (!slot) throw new ApiError(422, "slot_unavailable", slotProblemMessage(v.slots, "no_service"));
  const problem = slotProblem(v.slots, slot, now);
  if (problem) throw new ApiError(422, "slot_unavailable", slotProblemMessage(v.slots, problem));
  return slot;
}

export function turnOrThrow(v: BookingVenue, party: number): number {
  const turn = turnMinutes(v.turnTimes, party);
  if (turn === null || party > v.json.booking.maxParty) {
    throw new ApiError(
      422,
      "party_too_large",
      `Online booking is for parties of up to ${v.json.booking.maxParty}. Please call ${v.json.contact.phone} for a larger party.`,
    );
  }
  return turn;
}

export async function availability(
  v: BookingVenue,
  args: { date: string; time: string; party: number },
  now = new Date(),
): Promise<AvailabilityResponse> {
  const slot = resolveSlot(v, args.date, args.time, now);
  const turn = turnMinutes(v.turnTimes, args.party);
  const window = dayWindow(v, args.date)!;
  const busy = await loadBusy(v.id, window.from, window.to);
  const answers = tablesForSlot(v, slot, args.party, busy);
  const dayType = dayTypeOf(v.rules, v.slots.weekendDays, slot.date);
  return {
    venueId: v.id,
    slot: slotViewFromSlot(slot, slotEnd(slot.startsAt, turn ?? maxTurnMinutes(v.turnTimes)), dayType),
    tables: answers.map(({ code, state, feeCents, reason }) => ({ code, state, feeCents, reason })),
    alternatives: alternativesFor(v, slot, args.party, answers, busy, now),
    generatedAt: now.toISOString(),
  };
}

export async function slotsForDate(
  v: BookingVenue,
  args: { date: string; party: number },
  now = new Date(),
): Promise<SlotsResponse> {
  const slots = bookableSlots(v.slots, args.date, now);
  const window = dayWindow(v, args.date);
  const busy = window && slots.length ? await loadBusy(v.id, window.from, window.to) : [];
  const dayparts = v.json.booking.dayparts
    .filter((d) => daySlots(v.slots, args.date).some((s) => s.daypart === d.id))
    .map((d) => ({
      id: d.id,
      name: d.name,
      times: slots
        .filter((s) => s.daypart === d.id)
        .map((s) => ({
          time: s.time,
          startsAt: s.startsAt.toISOString(),
          freeTables: tablesForSlot(v, s, args.party, busy).filter((a) => a.state === "available").length,
        })),
    }));
  return { venueId: v.id, date: args.date, dayparts };
}

/**
 * PRD G-11: the next free slots for one table, from the requested slot onward, across
 * days up to the end of the booking window.
 */
export async function timesForTable(
  v: BookingVenue,
  args: { code: string; date: string; time: string; party: number; limit: number },
  now = new Date(),
): Promise<TableTimesResponse> {
  const table = v.byCode.get(args.code);
  if (!table) throw new ApiError(404, "table_not_found", "We could not find this table.");
  if (!table.bookable) throw new ApiError(422, "not_bookable", "This table is not booked online. The host seats it on arrival.");
  const turn = turnOrThrow(v, args.party);
  if (!fitsParty(table, args.party)) throw new ApiError(409, "wrong_size", wrongSizeReason(table, args.party));

  const from = zonedInstant(args.date, args.time, v.timezone) ?? new Date(`${args.date}T00:00:00Z`);
  const last = lastBookableDate(v.slots, now);
  if (args.date > last) return { code: table.code, times: [] };
  // Through the end of the last bookable day, plus the longest turn that can start on it.
  const until = slotEnd(startOfLocalDay(addDays(last, 1), v.timezone), maxTurnMinutes(v.turnTimes));
  const busy = await loadBusy(v.id, from, until, { tableId: table.id });

  const times: TableTimesResponse["times"] = [];
  for (let date = args.date; date <= last && times.length < args.limit; date = addDays(date, 1)) {
    for (const s of daySlots(v.slots, date)) {
      if (times.length >= args.limit) break;
      if (s.startsAt.getTime() < from.getTime() || slotProblem(v.slots, s, now)) continue;
      const price = priceFor(v.rules, v.slots.weekendDays, { tier: table.tier, daypart: s.daypart, date: s.date });
      if (!price) continue;
      if (isBusy(busy, table.id, s.startsAt.getTime(), slotEnd(s.startsAt, turn).getTime())) continue;
      times.push({ date: s.date, time: s.time, startsAt: s.startsAt.toISOString(), feeCents: price.feeCents });
    }
  }
  return { code: table.code, times };
}
