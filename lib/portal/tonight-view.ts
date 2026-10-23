import type { PlanTableView } from "@/components/room/plan2d/plan2d";
import type { PortalReservation, TonightResponse } from "@/lib/api/contracts";
import { formatTime } from "@/lib/format";
import type { RoomTable } from "@/lib/room/types";

/**
 * How Tonight reads, from the server's bookings and table states: what each row says
 * about arrival, what each table on the plan shows, and the counts in the header.
 * Pure, so it is the same on the server, in the browser and in tests.
 */

export type Arrival =
  | { kind: "upcoming"; minutes: number }
  | { kind: "due"; minutes: number }
  | { kind: "late"; minutes: number }
  | { kind: "seated"; at: string | null }
  | { kind: "no_show" }
  | { kind: "cancelled" }
  | { kind: "ended" };

/** Minutes before the booking time when a guest counts as due. */
export const DUE_WINDOW_MINUTES = 15;

export function surname(name: string): string {
  const parts = name.trim().split(/\s+/);
  return parts.at(-1) ?? name;
}

/** "19:30" -> "7:30", for tight plan badges. */
export function clock(time: string): string {
  return formatTime(time).replace(/ (am|pm)$/, "");
}

/**
 * The instant Tonight is judged at: the real time when looking at today, the start of
 * a future date (nobody is late yet), or the end of a past date.
 */
export function effectiveNow(date: string, today: string, now: Date, dayEnd: Date, dayStart: Date): Date {
  if (date === today) return now;
  return date > today ? dayStart : dayEnd;
}

export function arrival(r: PortalReservation, now: Date): Arrival {
  if (r.status === "seated") return { kind: "seated", at: null };
  if (r.status === "no_show") return { kind: "no_show" };
  if (r.status === "cancelled" || r.status === "expired") return { kind: "cancelled" };
  const start = new Date(r.slot.startsAt).getTime();
  const end = new Date(r.slot.endsAt).getTime();
  const minutes = Math.round((start - now.getTime()) / 60_000);
  if (now.getTime() >= end) return { kind: "ended" };
  if (minutes < 0) return { kind: "late", minutes: -minutes };
  if (minutes <= DUE_WINDOW_MINUTES) return { kind: "due", minutes };
  return { kind: "upcoming", minutes };
}

export function arrivalText(a: Arrival): string {
  switch (a.kind) {
    case "upcoming":
      return a.minutes >= 120
        ? `In ${Math.floor(a.minutes / 60)} h ${a.minutes % 60} min`.replace(" 0 min", "")
        : `In ${a.minutes} min`;
    case "due":
      return a.minutes === 0 ? "Due now" : `Due in ${a.minutes} min`;
    case "late":
      return a.minutes >= 60
        ? `${Math.floor(a.minutes / 60)} h ${a.minutes % 60} min late`.replace(" 0 min", "")
        : `${a.minutes} min late`;
    case "seated":
      return "Seated";
    case "no_show":
      return "No-show";
    case "cancelled":
      return "Cancelled";
    case "ended":
      return "Not marked";
  }
}

export interface TonightSummary {
  /** Paid bookings still standing tonight: to arrive, seated or no-show. */
  paid: number;
  toArrive: number;
  seated: number;
  noShows: number;
  late: number;
  /** Table fees kept tonight (price minus refunds), in cents. */
  feesCents: number;
}

export function summarize(list: PortalReservation[], now: Date): TonightSummary {
  const s: TonightSummary = { paid: 0, toArrive: 0, seated: 0, noShows: 0, late: 0, feesCents: 0 };
  for (const r of list) {
    if (!r.paid || r.status === "cancelled" || r.status === "expired" || r.status === "held") continue;
    s.paid += 1;
    s.feesCents += r.priceCents - r.refundCents;
    if (r.status === "seated") s.seated += 1;
    else if (r.status === "no_show") s.noShows += 1;
    else {
      s.toArrive += 1;
      if (arrival(r, now).kind === "late") s.late += 1;
    }
  }
  return s;
}

/** The code a host says out loud: "W1", or "11" for "Table 11". */
export function shortLabel(t: Pick<RoomTable, "id" | "label" | "bookable">): string {
  if (t.bookable) return t.id;
  return /(\d+)$/.exec(t.label)?.[1] ?? t.id;
}

const rank = (r: PortalReservation) => (r.status === "cancelled" || r.status === "expired" ? 1 : 0);

/** Rows shown on Tonight, in time order (cancelled ones last). */
export function orderRows(list: PortalReservation[]): PortalReservation[] {
  return list
    .filter((r) => r.status !== "held")
    .sort(
      (a, b) => rank(a) - rank(b) || a.slot.startsAt.localeCompare(b.slot.startsAt) || a.tableLabel.localeCompare(b.tableLabel),
    );
}

/** What the plan shows for each table tonight. Paid tables carry their next booking. */
export function planViews(tables: RoomTable[], data: TonightResponse | null, now: Date): Record<string, PlanTableView> {
  const states = new Map(data?.tables.map((t) => [t.code, t.state]) ?? []);
  const list = data?.reservations ?? [];
  const out: Record<string, PlanTableView> = {};
  for (const t of tables) {
    const short = shortLabel(t);
    const state = states.get(t.id) ?? "free";
    const seatedHere = list.find(
      (r) => r.status === "seated" && (r.seatedTable ?? r.table) === t.id && new Date(r.slot.endsAt).getTime() > now.getTime(),
    );
    const next = list
      .filter((r) => r.table === t.id && r.status === "confirmed" && new Date(r.slot.endsAt).getTime() > now.getTime())
      .sort((a, b) => a.slot.startsAt.localeCompare(b.slot.startsAt))[0];
    // The plan names tables by the code a host says ("W2"); the list beside it has the full names.
    const base = { label: short, short, shortDetail: short, ring: "none" as const, faded: false, muted: true, detail: null };

    if (state === "blocked") {
      out[t.id] = { ...base, ring: "hatched", detail: "Blocked", ariaLabel: `${t.label}, blocked`, priority: 2 };
      continue;
    }
    if (seatedHere) {
      const later = next ? `, next ${formatTime(next.slot.time)} ${next.guestName}` : "";
      out[t.id] = {
        ...base,
        ring: "solid",
        muted: false,
        detail: surname(seatedHere.guestName),
        badge: "Seated",
        badgeTone: "success",
        ariaLabel: `${t.label}, seated, ${seatedHere.guestName}, party of ${seatedHere.partySize}${later}`,
        priority: 3,
      };
      continue;
    }
    if (next) {
      const late = new Date(next.slot.startsAt).getTime() < now.getTime();
      out[t.id] = {
        ...base,
        ring: "bold",
        muted: false,
        detail: surname(next.guestName),
        // Just the time: badges must fit side by side on a tablet plan. The fill says paid or late.
        badge: clock(next.slot.time),
        badgeTone: late ? "warning" : "accent",
        ariaLabel: `${t.label}, paid, ${next.guestName} at ${formatTime(next.slot.time)}, party of ${next.partySize}${late ? ", late" : ""}`,
        priority: late ? 5 : 4,
      };
      continue;
    }
    if (state === "held") {
      out[t.id] = {
        ...base,
        ring: "dashed",
        muted: false,
        detail: "Held",
        ariaLabel: `${t.label}, held by a guest checking out`,
        priority: 2,
      };
      continue;
    }
    out[t.id] = {
      ...base,
      ariaLabel: `${t.label}, ${t.bookable ? "free" : "not booked online"}`,
      priority: t.bookable ? 1 : 0.5,
    };
  }
  return out;
}
