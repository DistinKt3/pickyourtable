import { TZDate } from "@date-fns/tz";

/**
 * Wall-clock time in a venue's time zone. Every slot and every "date" a guest or host
 * sees is local to the venue; every stored instant is UTC. These helpers are the only
 * place the two meet.
 */

export function timeToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number) as [number, number];
  return h * 60 + m;
}

export function minutesToTime(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/**
 * The instant at which the venue's clocks read `date` `time`. Returns null for a wall
 * time that does not exist (the hour skipped when clocks spring forward). A wall time
 * that happens twice (when clocks fall back) resolves to its first occurrence.
 */
export function zonedInstant(date: string, time: string, timeZone: string): Date | null {
  const [y, mo, d] = date.split("-").map(Number) as [number, number, number];
  const [h, mi] = time.split(":").map(Number) as [number, number];
  const t = new TZDate(y, mo - 1, d, h, mi, 0, timeZone);
  if (t.getFullYear() !== y || t.getMonth() !== mo - 1 || t.getDate() !== d || t.getHours() !== h || t.getMinutes() !== mi) {
    return null;
  }
  return new Date(t.getTime());
}

/** Start of a local calendar day. Falls forward to the first wall time that exists. */
export function startOfLocalDay(date: string, timeZone: string): Date {
  for (let m = 0; m < 180; m += 15) {
    const t = zonedInstant(date, minutesToTime(m), timeZone);
    if (t) return t;
  }
  throw new Error(`no start of day for ${date} in ${timeZone}`);
}

export interface LocalDateTime {
  date: string;
  time: string;
  /** ISO weekday, 1 = Monday ... 7 = Sunday. */
  weekday: number;
}

export function localDateTime(instant: Date, timeZone: string): LocalDateTime {
  const t = new TZDate(instant.getTime(), timeZone);
  const date = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
  const time = `${String(t.getHours()).padStart(2, "0")}:${String(t.getMinutes()).padStart(2, "0")}`;
  const day = t.getDay();
  return { date, time, weekday: day === 0 ? 7 : day };
}

export function addMinutes(instant: Date, minutes: number): Date {
  return new Date(instant.getTime() + minutes * 60_000);
}
