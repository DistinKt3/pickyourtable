import type { DayType } from "@/db/schema";
import { addDays, isoWeekday, todayIn } from "@/lib/format";
import { addMinutes, localDateTime, minutesToTime, timeToMinutes, zonedInstant } from "./time";

/**
 * Slot math (PRD "Data, availability and payments"). Pure functions: slots start every
 * 15 minutes inside each daypart, half-open (dinner 17:00 to 22:00 offers 17:00 to
 * 21:45), on the venue's wall clock. A reservation occupies its start plus the turn
 * time for its party size, measured in real minutes, so a booking that crosses a
 * clock change still lasts exactly its turn time.
 */

export interface DaypartConfig {
  id: string;
  name: string;
  /** ISO weekdays, 1 = Monday ... 7 = Sunday. */
  days: number[];
  start: string;
  end: string;
}

export interface SlotConfig {
  timezone: string;
  slotMinutes: number;
  minLeadMinutes: number;
  bookingWindowDays: number;
  /** ISO weekdays priced as weekend. */
  weekendDays: number[];
  dayparts: DaypartConfig[];
}

export interface TurnTime {
  minParty: number;
  maxParty: number;
  minutes: number;
}

export interface Slot {
  date: string;
  time: string;
  startsAt: Date;
  daypart: string;
  daypartName: string;
}

export type SlotProblem = "too_soon" | "too_far";

/** Every start time on a date's dayparts, before lead time and the booking window apply. */
export function daySlots(cfg: SlotConfig, date: string): Slot[] {
  const weekday = isoWeekday(date);
  const out: Slot[] = [];
  const seen = new Set<number>();
  for (const d of cfg.dayparts) {
    if (!d.days.includes(weekday)) continue;
    const end = timeToMinutes(d.end);
    for (let m = timeToMinutes(d.start); m < end; m += cfg.slotMinutes) {
      const time = minutesToTime(m);
      const startsAt = zonedInstant(date, time, cfg.timezone);
      // A wall time skipped by the clock change has no slot.
      if (!startsAt || seen.has(startsAt.getTime())) continue;
      seen.add(startsAt.getTime());
      out.push({ date, time, startsAt, daypart: d.id, daypartName: d.name });
    }
  }
  return out.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
}

/** The slot at `date` `time`, if it is a real start time on that day. */
export function findSlot(cfg: SlotConfig, date: string, time: string): Slot | null {
  return daySlots(cfg, date).find((s) => s.time === time) ?? null;
}

/** The last date guests can book, in the venue's time zone. */
export function lastBookableDate(cfg: SlotConfig, now: Date): string {
  return addDays(todayIn(cfg.timezone, now), cfg.bookingWindowDays);
}

/** Why a slot cannot be booked right now, or null when it can. */
export function slotProblem(cfg: SlotConfig, slot: Pick<Slot, "date" | "startsAt">, now: Date): SlotProblem | null {
  if (slot.startsAt.getTime() < addMinutes(now, cfg.minLeadMinutes).getTime()) return "too_soon";
  if (slot.date > lastBookableDate(cfg, now)) return "too_far";
  return null;
}

/** Start times guests can book on a date right now. */
export function bookableSlots(cfg: SlotConfig, date: string, now: Date): Slot[] {
  if (date > lastBookableDate(cfg, now)) return [];
  return daySlots(cfg, date).filter((s) => slotProblem(cfg, s, now) === null);
}

/** Turn time in minutes for a party, or null when no range covers it. */
export function turnMinutes(turnTimes: readonly TurnTime[], party: number): number | null {
  return turnTimes.find((t) => party >= t.minParty && party <= t.maxParty)?.minutes ?? null;
}

export function maxTurnMinutes(turnTimes: readonly TurnTime[]): number {
  return turnTimes.reduce((m, t) => Math.max(m, t.minutes), 0);
}

/** When a reservation starting at `startsAt` frees its table. */
export function slotEnd(startsAt: Date, minutes: number): Date {
  return addMinutes(startsAt, minutes);
}

/**
 * Day type for pricing: `special` when the venue has a special-date price rule for the
 * date, else `weekend` when its weekday is a weekend day, else `weeknight`.
 */
export function dayTypeFor(date: string, weekendDays: readonly number[], specialDates: ReadonlySet<string>): DayType {
  if (specialDates.has(date)) return "special";
  return weekendDays.includes(isoWeekday(date)) ? "weekend" : "weeknight";
}

/** The local date and HH:MM of an instant, for building slot views from stored rows. */
export function slotParts(startsAt: Date, timeZone: string): { date: string; time: string } {
  const { date, time } = localDateTime(startsAt, timeZone);
  return { date, time };
}

/** Plain words for a slot that cannot be booked. */
export function slotProblemMessage(cfg: SlotConfig, problem: SlotProblem | "no_service"): string {
  switch (problem) {
    case "no_service":
      return "There is no seating at this time. Choose another time.";
    case "too_soon":
      return cfg.minLeadMinutes === 0
        ? "This time has already started. Choose a later time."
        : `Online booking closes ${leadWords(cfg.minLeadMinutes)} before each time. Choose a later time.`;
    case "too_far":
      return `Bookings open ${cfg.bookingWindowDays} days ahead. Choose an earlier date.`;
  }
}

function leadWords(minutes: number): string {
  if (minutes % 60 === 0) {
    const h = minutes / 60;
    return h === 1 ? "1 hour" : `${h} hours`;
  }
  return `${minutes} minutes`;
}
