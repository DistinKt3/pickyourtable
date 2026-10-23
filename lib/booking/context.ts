import "server-only";
import { asc, eq } from "drizzle-orm";
import { db, type Queryable } from "@/db/client";
import { priceRule, turnTime, venue as venueRow, venueTable } from "@/db/schema";
import { ApiError } from "@/lib/http/api";
import { loadVenue, VenueNotFoundError } from "@/lib/venue/load";
import type { Venue } from "@/lib/venue/schema";
import type { PriceRuleLike } from "./pricing";
import type { SlotConfig, TurnTime } from "./slots";

/**
 * Everything the booking server needs to answer for one venue: its database row
 * (time zone, Stripe account, fee share, live flag), the owner-editable table settings,
 * price rules and turn times, plus the geometry and booking rules from venue.json.
 */

export interface BookingTable {
  id: string;
  code: string;
  label: string;
  tier: string;
  seats: number;
  minParty: number;
  maxParty: number;
  attributes: string[];
  photoId: string | null;
  bookable: boolean;
  sort: number;
  /** Position on the floor, from venue.json. */
  x: number;
  z: number;
}

export interface BookingVenue {
  id: string;
  name: string;
  timezone: string;
  live: boolean;
  stripeAccountId: string | null;
  applicationFeeBps: number;
  json: Venue;
  slots: SlotConfig;
  tables: BookingTable[];
  byCode: Map<string, BookingTable>;
  byId: Map<string, BookingTable>;
  rules: PriceRuleLike[];
  turnTimes: TurnTime[];
}

export async function loadBookingVenue(venueId: string, q: Queryable = db()): Promise<BookingVenue | null> {
  let json: Venue;
  try {
    json = await loadVenue(venueId);
  } catch (e) {
    if (e instanceof VenueNotFoundError) return null;
    throw e;
  }
  const [rows, tables, rules, turns] = await Promise.all([
    q.select().from(venueRow).where(eq(venueRow.id, venueId)),
    q.select().from(venueTable).where(eq(venueTable.venueId, venueId)).orderBy(asc(venueTable.sort)),
    q.select().from(priceRule).where(eq(priceRule.venueId, venueId)),
    q.select().from(turnTime).where(eq(turnTime.venueId, venueId)).orderBy(asc(turnTime.minParty)),
  ]);
  const v = rows[0];
  if (!v) return null;

  const geometry = new Map(json.tables.map((t) => [t.id, t]));
  const list: BookingTable[] = tables.map((t) => {
    const g = geometry.get(t.code);
    return {
      id: t.id,
      code: t.code,
      label: t.label,
      tier: t.tier,
      seats: t.seats,
      minParty: t.minParty,
      maxParty: t.maxParty,
      attributes: t.attributes,
      photoId: t.photoId,
      // A table no longer in venue.json has no place in the room, so it cannot be booked.
      bookable: t.bookable && Boolean(g),
      sort: t.sort,
      x: g?.x ?? 0,
      z: g?.z ?? 0,
    };
  });

  return {
    id: v.id,
    name: v.name,
    timezone: v.timezone,
    live: v.live,
    stripeAccountId: v.stripeAccountId,
    applicationFeeBps: v.applicationFeeBps,
    json,
    slots: {
      timezone: v.timezone,
      slotMinutes: json.booking.slotMinutes,
      minLeadMinutes: json.booking.minLeadMinutes,
      bookingWindowDays: json.booking.bookingWindowDays,
      weekendDays: json.booking.weekendDays,
      dayparts: json.booking.dayparts,
    },
    tables: list,
    byCode: new Map(list.map((t) => [t.code, t])),
    byId: new Map(list.map((t) => [t.id, t])),
    rules: rules.map((r) => ({
      tier: r.tier,
      daypart: r.daypart,
      dayType: r.dayType,
      specialDate: r.specialDate,
      feeCents: r.feeCents,
    })),
    turnTimes: turns.map((t) => ({ minParty: t.minParty, maxParty: t.maxParty, minutes: t.minutes })),
  };
}

/** For guest routes: the venue, or 404 when unknown and 403 when it is not live yet. */
export async function requireGuestVenue(venueId: string): Promise<BookingVenue> {
  const v = await loadBookingVenue(venueId);
  if (!v) throw new ApiError(404, "venue_not_found", "We could not find this venue.");
  if (!v.live) throw new ApiError(403, "venue_not_live", "This venue is not taking online bookings yet.");
  return v;
}

export function tierName(v: BookingVenue, tier: string): string {
  return v.json.tiers.find((t) => t.id === tier)?.name ?? tier;
}

export function daypartName(v: BookingVenue, daypart: string): string {
  return v.json.booking.dayparts.find((d) => d.id === daypart)?.name ?? daypart;
}
