import { TZDate } from "@date-fns/tz";

/**
 * Venue-local wall-clock times and UTC instants. The portal takes dates and times
 * in the venue's time zone (what the owner sees on the restaurant's clock) and the
 * database stores UTC instants. All conversion goes through @date-fns/tz, so the
 * November and March clock changes land on the right instant.
 */

function parts(date: string, time = "00:00"): [number, number, number, number, number] {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const [hh, mm] = time.split(":").map(Number) as [number, number];
  return [y, m - 1, d, hh, mm];
}

/** "2026-11-02" + "17:00" in America/Los_Angeles -> 2026-11-03T01:00:00.000Z */
export function localToUtc(date: string, time: string, timeZone: string): Date {
  const [y, m, d, hh, mm] = parts(date, time);
  return new Date(new TZDate(y, m, d, hh, mm, 0, timeZone).getTime());
}

/** The UTC instants that bound a venue-local calendar date: [start, next day's start). */
export function localDayRange(date: string, timeZone: string): { start: Date; end: Date } {
  const [y, m, d] = parts(date);
  const start = new TZDate(y, m, d, 0, 0, 0, timeZone);
  const end = new TZDate(y, m, d + 1, 0, 0, 0, timeZone);
  return { start: new Date(start.getTime()), end: new Date(end.getTime()) };
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
    formatters.set(timeZone, f);
  }
  return f;
}

/** A UTC instant as the venue's local date (YYYY-MM-DD) and time (HH:MM). */
export function utcToLocal(instant: Date | string, timeZone: string): { date: string; time: string } {
  const map: Record<string, string> = {};
  for (const p of formatter(timeZone).formatToParts(new Date(instant))) map[p.type] = p.value;
  return { date: `${map.year}-${map.month}-${map.day}`, time: `${map.hour}:${map.minute}` };
}

/** Minutes since local midnight for an HH:MM string. */
export function minutesOf(time: string): number {
  const [h, m] = time.split(":").map(Number) as [number, number];
  return h * 60 + m;
}

/** The last minute of a day, used for "all day" ranges (the contract's times stop at 23:59). */
export const END_OF_DAY = "23:59";

/** Short name of the venue's time zone on a date, such as "PDT" or "PST". */
export function zoneAbbreviation(date: string, timeZone: string): string {
  const at = localToUtc(date, "12:00", timeZone);
  const name = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "short" })
    .formatToParts(at)
    .find((p) => p.type === "timeZoneName")?.value;
  return name ?? timeZone;
}

/** Long name of the venue's time zone, such as "Pacific Time". */
export function zoneLongName(timeZone: string): string {
  const name = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "longGeneric" })
    .formatToParts(new Date())
    .find((p) => p.type === "timeZoneName")?.value;
  return name ?? timeZone;
}

/** The server's clock as an ISO instant, handed to client screens so their first paint matches. */
export function serverNowIso(): string {
  return new Date().toISOString();
}
