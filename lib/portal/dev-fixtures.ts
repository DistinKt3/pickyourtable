import "server-only";
import { and, asc, eq, gte, inArray, like, lt } from "drizzle-orm";
import { db } from "@/db/client";
import { blackout, guest, priceRule, reservation, turnTime, venue as venueRow, venueTable } from "@/db/schema";
import type { BookingsResponse, PortalReservation, TonightResponse } from "@/lib/api/contracts";
import { addDays, isoWeekday } from "@/lib/format";
import { randomToken, sha256 } from "@/lib/security/crypto";
import { loadVenue } from "@/lib/venue/load";
import type { Venue } from "@/lib/venue/schema";
import { localDayRange, localToUtc, minutesOf, utcToLocal } from "./time";

/**
 * Development and test fixtures only: realistic paid bookings inserted straight
 * into the database (guest + reservation rows that satisfy every constraint,
 * including no-overlap), and read models built from those rows for the screenshot
 * script while the booking service's operations are still being built. Nothing in
 * the app imports this file.
 */

export const FIXTURE_PAYMENT_PREFIX = "pi_devfx_";

type Status = "confirmed" | "seated" | "no_show" | "cancelled";

interface Spec {
  /** Index into the venue's bookable tables, in venue.json order. */
  table: number;
  time: string;
  party: number;
  name: string;
  occasion?: string;
  note?: string;
  status: Status;
  /** Minutes after the booking time that the guest was seated. */
  seatedAfter?: number;
  /** Seat at this index of the venue's non-bookable tables instead (refunds the fee). */
  seatedElsewhere?: number;
  card: [brand: string, last4: string];
}

/** Tonight at a busy waterfront room: early tables seated, the 7:30 rush arriving, a late seating. */
const TONIGHT: Spec[] = [
  { table: 1, time: "17:00", party: 2, name: "Leila Haddad", status: "seated", seatedAfter: 3, card: ["visa", "4242"] },
  {
    table: 7,
    time: "17:15",
    party: 4,
    name: "Cormac Brennan",
    occasion: "business",
    status: "seated",
    seatedAfter: 6,
    card: ["amex", "8431"],
  },
  { table: 10, time: "17:45", party: 2, name: "Tomasz Kowal", status: "no_show", card: ["mastercard", "5100"] },
  {
    table: 4,
    time: "18:30",
    party: 2,
    name: "Ana Ferreira",
    note: "Needs step-free access",
    status: "seated",
    seatedAfter: 4,
    seatedElsewhere: 1,
    card: ["apple_pay", "1881"],
  },
  {
    table: 6,
    time: "18:30",
    party: 4,
    name: "Ingrid Lindqvist",
    occasion: "birthday",
    note: "Bringing a cake. Candles at dessert, please.",
    status: "seated",
    seatedAfter: 2,
    card: ["visa", "0077"],
  },
  {
    table: 0,
    time: "19:30",
    party: 2,
    name: "Elena Marchetti",
    occasion: "anniversary",
    note: "Ten years today. Seat facing the water if possible.",
    status: "confirmed",
    card: ["visa", "9921"],
  },
  {
    table: 11,
    time: "19:45",
    party: 2,
    name: "David Okafor",
    note: "Shellfish allergy",
    status: "confirmed",
    card: ["mastercard", "3110"],
  },
  {
    table: 2,
    time: "20:00",
    party: 2,
    name: "Maya Abernathy",
    occasion: "date-night",
    status: "confirmed",
    card: ["google_pay", "6604"],
  },
  {
    table: 8,
    time: "20:00",
    party: 4,
    name: "Rafael Castellanos",
    occasion: "business",
    note: "Client dinner. Please give the bill to me.",
    status: "confirmed",
    card: ["amex", "1007"],
  },
  {
    table: 14,
    time: "20:15",
    party: 4,
    name: "Priya Raman",
    occasion: "celebration",
    status: "confirmed",
    card: ["visa", "2234"],
  },
  { table: 9, time: "20:30", party: 3, name: "Owen Grant", status: "cancelled", card: ["visa", "7310"] },
  { table: 3, time: "20:30", party: 2, name: "Camille Delacroix", status: "confirmed", card: ["apple_pay", "4402"] },
  { table: 1, time: "21:00", party: 2, name: "Henrik Sorensen", status: "confirmed", card: ["mastercard", "8890"] },
  {
    table: 12,
    time: "21:15",
    party: 1,
    name: "Yuki Iwasaki",
    note: "Happy to sit at the far end",
    status: "confirmed",
    card: ["visa", "5521"],
  },
];

const LATER: Spec[] = [
  {
    table: 5,
    time: "19:00",
    party: 2,
    name: "Nadia Petrova",
    occasion: "anniversary",
    status: "confirmed",
    card: ["visa", "1212"],
  },
  {
    table: 8,
    time: "19:30",
    party: 4,
    name: "Samuel Osei",
    occasion: "birthday",
    status: "confirmed",
    card: ["mastercard", "4545"],
  },
  { table: 13, time: "20:00", party: 3, name: "Lucia Romero", status: "confirmed", card: ["apple_pay", "7788"] },
  {
    table: 0,
    time: "20:45",
    party: 2,
    name: "Felix Hartmann",
    occasion: "date-night",
    status: "confirmed",
    card: ["amex", "3003"],
  },
];

const PAST: Spec[] = [
  { table: 0, time: "19:00", party: 2, name: "Grace Whitfield", status: "seated", seatedAfter: 5, card: ["visa", "6161"] },
  {
    table: 7,
    time: "20:00",
    party: 4,
    name: "Marco Bellini",
    occasion: "celebration",
    status: "seated",
    seatedAfter: 1,
    card: ["visa", "2020"],
  },
  { table: 11, time: "20:30", party: 2, name: "Jonah Feld", status: "no_show", card: ["mastercard", "9090"] },
];

interface Context {
  venue: Venue;
  bookable: (typeof venueTable.$inferSelect)[];
  other: (typeof venueTable.$inferSelect)[];
  turns: { minParty: number; maxParty: number; minutes: number }[];
  rules: (typeof priceRule.$inferSelect)[];
  feeBps: number;
}

async function context(venueId: string): Promise<Context> {
  const venue = await loadVenue(venueId);
  const order = new Map(venue.tables.map((t, i) => [t.id, i]));
  const [tables, turns, rules, vrows] = await Promise.all([
    db().select().from(venueTable).where(eq(venueTable.venueId, venueId)),
    db().select().from(turnTime).where(eq(turnTime.venueId, venueId)).orderBy(asc(turnTime.minParty)),
    db().select().from(priceRule).where(eq(priceRule.venueId, venueId)),
    db().select({ bps: venueRow.applicationFeeBps }).from(venueRow).where(eq(venueRow.id, venueId)),
  ]);
  const known = tables.filter((t) => order.has(t.code)).sort((a, b) => order.get(a.code)! - order.get(b.code)!);
  return {
    venue,
    bookable: known.filter((t) => t.bookable),
    other: known.filter((t) => !t.bookable),
    turns,
    rules,
    feeBps: vrows[0]?.bps ?? 3000,
  };
}

function price(
  ctx: Context,
  tier: string,
  daypart: string,
  date: string,
): { cents: number; dayType: "weeknight" | "weekend" | "special" } {
  const special = ctx.rules.find(
    (r) => r.tier === tier && r.daypart === daypart && r.dayType === "special" && r.specialDate === date,
  );
  if (special) return { cents: special.feeCents, dayType: "special" };
  const dayType = ctx.venue.booking.weekendDays.includes(isoWeekday(date)) ? "weekend" : "weeknight";
  const rule = ctx.rules.find((r) => r.tier === tier && r.daypart === daypart && r.dayType === dayType);
  return { cents: rule?.feeCents ?? ctx.venue.booking.fees[tier]?.[dayType] ?? 2000, dayType };
}

function daypartAt(venue: Venue, date: string, time: string) {
  const day = isoWeekday(date);
  const m = minutesOf(time);
  return (
    venue.booking.dayparts.find((d) => d.days.includes(day) && m >= minutesOf(d.start) && m < minutesOf(d.end)) ??
    venue.booking.dayparts.at(-1)!
  );
}

function surnameEmail(name: string): string {
  return `${name.toLowerCase().replace(/[^a-z]+/g, ".")}@guest.example`;
}

/** Removes fixture bookings for a venue (identified by their PaymentIntent prefix). */
export async function clearFixtureReservations(venueId: string): Promise<void> {
  const rows = await db()
    .select({ id: reservation.id, guestId: reservation.guestId })
    .from(reservation)
    .where(and(eq(reservation.venueId, venueId), like(reservation.paymentIntentId, `${FIXTURE_PAYMENT_PREFIX}%`)));
  if (!rows.length) return;
  await db()
    .delete(reservation)
    .where(
      inArray(
        reservation.id,
        rows.map((r) => r.id),
      ),
    );
  const guests = rows.map((r) => r.guestId).filter((g): g is string => Boolean(g));
  if (guests.length) await db().delete(guest).where(inArray(guest.id, guests));
}

async function insertSpecs(ctx: Context, date: string, specs: Spec[]): Promise<string[]> {
  const ids: string[] = [];
  const tz = ctx.venue.timezone;
  // Venues with fewer tables wrap the indexes; skip any booking that would overlap.
  const taken = new Map<string, [number, number][]>();
  for (const s of specs) {
    const table = ctx.bookable[s.table % Math.max(1, ctx.bookable.length)];
    if (!table) continue;
    const party = Math.min(Math.max(s.party, table.minParty), table.maxParty);
    const turn = ctx.turns.find((t) => party >= t.minParty && party <= t.maxParty)?.minutes ?? 120;
    const startsAt = localToUtc(date, s.time, tz);
    const endsAt = new Date(startsAt.getTime() + turn * 60_000);
    if (s.status === "confirmed" || s.status === "seated") {
      const spans = taken.get(table.id) ?? [];
      if (spans.some(([a, b]) => startsAt.getTime() < b && endsAt.getTime() > a)) continue;
      spans.push([startsAt.getTime(), endsAt.getTime()]);
      taken.set(table.id, spans);
    }
    const daypart = daypartAt(ctx.venue, date, s.time);
    const fee = price(ctx, table.tier, daypart.id, date);
    const elsewhere = s.seatedElsewhere !== undefined ? ctx.other[s.seatedElsewhere % Math.max(1, ctx.other.length)] : undefined;
    const confirmedAt = new Date(startsAt.getTime() - 5 * 86_400_000);
    const email = surnameEmail(s.name);
    const [g] = await db()
      .insert(guest)
      .values({
        name: s.name,
        email,
        mobile: `+1 415 555 0${String(100 + ids.length).slice(-3)}`,
        occasion: s.occasion ?? null,
        note: s.note ?? null,
      })
      .returning({ id: guest.id });
    const refunded = s.status === "cancelled" || Boolean(elsewhere);
    const [r] = await db()
      .insert(reservation)
      .values({
        venueId: ctx.venue.id,
        tableId: table.id,
        partySize: party,
        startsAt,
        endsAt,
        daypart: daypart.id,
        dayType: fee.dayType,
        status: s.status,
        guestId: g!.id,
        priceCents: fee.cents,
        applicationFeeCents: Math.round((fee.cents * ctx.feeBps) / 10_000),
        paymentIntentId: `${FIXTURE_PAYMENT_PREFIX}${randomToken(12)}`,
        cardBrand: s.card[0],
        cardLast4: s.card[1],
        deviceHash: sha256(`fixture-device-${s.name}`).slice(0, 32),
        ipHash: sha256("fixture-ip").slice(0, 32),
        emailNorm: email,
        manageNonce: randomToken(16),
        seatedTableId: elsewhere?.id ?? null,
        refundCents: refunded ? fee.cents : 0,
        refundId: refunded ? `re_devfx_${randomToken(10)}` : null,
        refundedAt: refunded ? new Date(startsAt.getTime() - (s.status === "cancelled" ? 26 * 3_600_000 : -5 * 60_000)) : null,
        confirmedAt,
        seatedAt: s.status === "seated" ? new Date(startsAt.getTime() + (s.seatedAfter ?? 0) * 60_000) : null,
        cancelledAt: s.status === "cancelled" ? new Date(startsAt.getTime() - 26 * 3_600_000) : null,
        cancelReason: s.status === "cancelled" ? "Guest asked to cancel by phone" : null,
        createdAt: confirmedAt,
        updatedAt: confirmedAt,
      })
      .returning({ id: reservation.id });
    ids.push(r!.id);
  }
  return ids;
}

/**
 * Seeds a realistic service: `date` gets a full Friday-night book (seated tables, a
 * no-show, a guest seated elsewhere with a refund, a cancellation, the 7:30 rush),
 * the day before has finished bookings, and the next two days have a few each.
 */
export async function seedFixtureReservations(venueId: string, date: string): Promise<{ ids: string[] }> {
  await clearFixtureReservations(venueId);
  const ctx = await context(venueId);
  const ids = [
    ...(await insertSpecs(ctx, addDays(date, -1), PAST)),
    ...(await insertSpecs(ctx, date, TONIGHT)),
    ...(await insertSpecs(ctx, addDays(date, 1), LATER)),
    ...(await insertSpecs(ctx, addDays(date, 2), LATER.slice(0, 2))),
  ];
  return { ids };
}

/** Inserts only the given bookings on `date` (tests). */
export async function seedBookings(
  venueId: string,
  date: string,
  specs: { table: string; time: string; party: number; name: string; status?: Status; occasion?: string; note?: string }[],
): Promise<string[]> {
  const ctx = await context(venueId);
  const index = (code: string) => ctx.bookable.findIndex((t) => t.code === code);
  return insertSpecs(
    ctx,
    date,
    specs.map((s) => ({
      ...s,
      table: index(s.table),
      status: s.status ?? "confirmed",
      card: ["visa", "4242"] as [string, string],
    })),
  );
}

/* ----------------------------------------------- Read models for screenshots */

const rowColumns = {
  r: reservation,
  code: venueTable.code,
  label: venueTable.label,
  tier: venueTable.tier,
  guestName: guest.name,
  guestEmail: guest.email,
  guestMobile: guest.mobile,
  occasion: guest.occasion,
  note: guest.note,
};

type Row = {
  r: typeof reservation.$inferSelect;
  code: string;
  label: string;
  tier: string;
  guestName: string | null;
  guestEmail: string | null;
  guestMobile: string | null;
  occasion: string | null;
  note: string | null;
};

function toPortalReservation(venue: Venue, row: Row, seatedCode: string | null): PortalReservation {
  const tz = venue.timezone;
  const start = utcToLocal(row.r.startsAt, tz);
  const daypart = venue.booking.dayparts.find((d) => d.id === row.r.daypart);
  return {
    id: row.r.id,
    table: row.code,
    tableLabel: row.label,
    tier: row.tier,
    seatedTable: seatedCode,
    partySize: row.r.partySize,
    slot: {
      date: start.date,
      time: start.time,
      startsAt: row.r.startsAt.toISOString(),
      endsAt: row.r.endsAt.toISOString(),
      daypart: row.r.daypart,
      daypartName: daypart?.name ?? row.r.daypart,
      dayType: row.r.dayType,
    },
    status: row.r.status,
    guestName: row.guestName ?? "Guest",
    guestEmail: row.guestEmail ?? "",
    guestMobile: row.guestMobile ?? "",
    occasion: row.occasion,
    note: row.note,
    priceCents: row.r.priceCents,
    refundCents: row.r.refundCents,
    paid: row.r.status !== "held" && row.r.status !== "expired",
    cardBrand: row.r.cardBrand,
    cardLast4: row.r.cardLast4,
    createdAt: row.r.createdAt.toISOString(),
  };
}

async function readRows(venueId: string, range?: { start: Date; end: Date }) {
  const found = await db()
    .select(rowColumns)
    .from(reservation)
    .innerJoin(venueTable, eq(venueTable.id, reservation.tableId))
    .leftJoin(guest, eq(guest.id, reservation.guestId))
    .where(
      and(
        eq(reservation.venueId, venueId),
        inArray(reservation.status, ["confirmed", "seated", "no_show", "cancelled"]),
        range ? gte(reservation.startsAt, range.start) : undefined,
        range ? lt(reservation.startsAt, range.end) : undefined,
      ),
    )
    .orderBy(asc(reservation.startsAt), asc(venueTable.sort));
  const tables = await db()
    .select({ id: venueTable.id, code: venueTable.code })
    .from(venueTable)
    .where(eq(venueTable.venueId, venueId));
  const codeById = new Map(tables.map((t) => [t.id, t.code]));
  return found.map((row) => ({ row, seated: row.r.seatedTableId ? (codeById.get(row.r.seatedTableId) ?? null) : null }));
}

/** A TonightResponse built from the database, for screenshots while `listTonight` is not built yet. */
export async function fixtureTonight(venueId: string, date: string, now: Date): Promise<TonightResponse> {
  const venue = await loadVenue(venueId);
  const day = localDayRange(date, venue.timezone);
  const list = (await readRows(venueId, day)).map(({ row, seated }) => toPortalReservation(venue, row, seated));
  const tables = await db().select().from(venueTable).where(eq(venueTable.venueId, venueId));
  const blocks = await db()
    .select()
    .from(blackout)
    .where(and(eq(blackout.venueId, venueId), lt(blackout.startsAt, day.end), gte(blackout.endsAt, day.start)));
  const at = now.getTime() >= day.start.getTime() && now.getTime() < day.end.getTime() ? now : day.start;
  const states = tables.map((t) => {
    const blocked = blocks.some((b) => (!b.tableId || b.tableId === t.id) && b.startsAt <= at && b.endsAt > at);
    const here = list.filter((r) => (r.seatedTable ?? r.table) === t.code);
    const seated = here.some((r) => r.status === "seated" && new Date(r.slot.startsAt) <= at && new Date(r.slot.endsAt) > at);
    const paid = list.some((r) => r.table === t.code && r.status === "confirmed" && new Date(r.slot.endsAt) > at);
    const state: TonightResponse["tables"][number]["state"] = blocked ? "blocked" : seated ? "seated" : paid ? "paid" : "free";
    return { code: t.code, state };
  });
  return { venueId, date, generatedAt: new Date().toISOString(), reservations: list, tables: states };
}

/** A BookingsResponse built from the database, for screenshots while `listBookings` is not built yet. */
export async function fixtureBookings(
  venueId: string,
  query: { q?: string; status: "upcoming" | "past" | "cancelled" | "all" },
  now: Date,
): Promise<BookingsResponse> {
  const venue = await loadVenue(venueId);
  let list = (await readRows(venueId)).map(({ row, seated }) => toPortalReservation(venue, row, seated));
  const q = query.q?.trim().toLowerCase();
  if (q) {
    list = list.filter((b) => [b.guestName, b.guestEmail, b.table, b.tableLabel].some((v) => v.toLowerCase().includes(q)));
  }
  const ended = (b: PortalReservation) => new Date(b.slot.endsAt) <= now;
  if (query.status === "upcoming") list = list.filter((b) => b.status === "confirmed" && !ended(b));
  if (query.status === "past")
    list = list.filter((b) => b.status !== "cancelled" && (b.status !== "confirmed" || ended(b))).reverse();
  if (query.status === "cancelled") list = list.filter((b) => b.status === "cancelled");
  return { bookings: list };
}
