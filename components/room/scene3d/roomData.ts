import type { TableAvailability } from "@/lib/api/contracts";
import type { RoomData, RoomTable } from "@/lib/room/types";
import { seatViewImage } from "@/lib/venue/media";
import type { Venue } from "@/lib/venue/schema";

/**
 * RoomData from venue.json alone, for the dev page and the seat-render route (no
 * database): bookable from the tier default, `fromCents` the lowest fee for the tier,
 * and the seat-view image for bookable tables.
 */
export function roomDataFromVenue(venue: Venue, modelUrl: string | null = null): RoomData {
  const tables: RoomTable[] = venue.tables.map((t) => {
    const tier = venue.tiers.find((x) => x.id === t.tier);
    const bookable = t.bookable ?? tier?.bookable ?? false;
    const fee = venue.booking.fees[t.tier];
    return {
      ...t,
      bookable,
      fromCents: bookable && fee ? Math.min(fee.weeknight, fee.weekend) : null,
      image: bookable ? seatViewImage(venue.id, t) : null,
    };
  });
  return { venue, tables, modelUrl };
}

/** A review slot: Friday 8 pm for two, weekend prices, with chosen tables taken or the wrong size. */
export const REVIEW_SLOT = { date: "2026-10-30", time: "20:00", party: 2 } as const;

export function reviewAvailability(data: RoomData, opts: { taken: string[]; wrong: string[] }): TableAvailability[] {
  return data.tables.map((t) => {
    if (!t.bookable) return { code: t.id, state: "not_bookable", feeCents: null, reason: "Seated by the host on arrival." };
    const fee = data.venue.booking.fees[t.tier]?.weekend ?? null;
    if (opts.taken.includes(t.id)) return { code: t.id, state: "taken", feeCents: fee, reason: "Already booked at this time." };
    if (opts.wrong.includes(t.id)) {
      return {
        code: t.id,
        state: "wrong_size",
        feeCents: fee,
        reason: `Seats ${t.minParty} to ${t.maxParty}. Your party is ${REVIEW_SLOT.party}.`,
      };
    }
    return { code: t.id, state: "available", feeCents: fee, reason: null };
  });
}
