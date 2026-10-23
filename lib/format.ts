/** Formatting shared by the guest widget, the portal and emails. English (US) only. */

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

/** $40, or $40.50 when there are cents. */
export function formatMoney(cents: number): string {
  const dollars = cents / 100;
  return dollars.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  });
}

/** "20:00" -> "8:00 pm" */
export function formatTime(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number) as [number, number];
  const suffix = h >= 12 ? "pm" : "am";
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}:${String(m).padStart(2, "0")} ${suffix}`;
}

/** Noon-anchored so the calendar date never shifts with the viewer's time zone. */
function dateAt(date: string): Date {
  return new Date(`${date}T12:00:00Z`);
}

/** "2026-10-30" -> "Fri, Oct 30" */
export function formatDate(date: string, opts: { weekday?: "short" | "long"; year?: boolean } = {}): string {
  return dateAt(date).toLocaleDateString("en-US", {
    timeZone: "UTC",
    weekday: opts.weekday ?? "short",
    month: "short",
    day: "numeric",
    ...(opts.year ? { year: "numeric" } : {}),
  });
}

/** "2026-10-30" -> "Friday, October 30" */
export function formatDateLong(date: string): string {
  return dateAt(date).toLocaleDateString("en-US", { timeZone: "UTC", weekday: "long", month: "long", day: "numeric" });
}

export function weekdayShort(date: string): string {
  return dateAt(date).toLocaleDateString("en-US", { timeZone: "UTC", weekday: "short" });
}

export function dayOfMonth(date: string): string {
  return String(dateAt(date).getUTCDate());
}

/** ISO weekday, 1 = Monday ... 7 = Sunday. */
export function isoWeekday(date: string): number {
  const d = dateAt(date).getUTCDay();
  return d === 0 ? 7 : d;
}

export function addDays(date: string, days: number): string {
  const d = dateAt(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Today's date in a time zone, as YYYY-MM-DD. */
export function todayIn(timeZone: string, now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  return parts;
}

/** Milliseconds -> "7:42" */
export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function partyLabel(n: number): string {
  return n === 1 ? "1 guest" : `${n} guests`;
}

const OCCASIONS: Record<string, string> = {
  anniversary: "Anniversary",
  birthday: "Birthday",
  business: "Business",
  "date-night": "Date night",
  celebration: "Celebration",
  other: "Other",
};

export function occasionLabel(id: string | null | undefined): string | null {
  return id ? (OCCASIONS[id] ?? null) : null;
}

export const occasionOptions = Object.entries(OCCASIONS).map(([value, label]) => ({ value, label }));

export function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
