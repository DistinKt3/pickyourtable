import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { priceRule, venue as venueRow, venueTable } from "@/db/schema";
import { loadVenue, venueModelUrl } from "@/lib/venue/load";
import { seatViewImage } from "@/lib/venue/media";
import type { RoomData, RoomTable } from "./types";

/**
 * Builds RoomData for a venue: geometry from venue.json, and the settings the owner
 * controls (tier, attributes, photo, bookable) from the database.
 */
export async function loadRoomData(venueId: string): Promise<{ data: RoomData; live: boolean }> {
  const venue = await loadVenue(venueId);
  const [rows, rules, vrows] = await Promise.all([
    db().select().from(venueTable).where(eq(venueTable.venueId, venueId)),
    db()
      .select({ tier: priceRule.tier, fee: priceRule.feeCents, dayType: priceRule.dayType })
      .from(priceRule)
      .where(eq(priceRule.venueId, venueId)),
    db().select({ live: venueRow.live }).from(venueRow).where(eq(venueRow.id, venueId)),
  ]);

  const byCode = new Map(rows.map((r) => [r.code, r]));
  const fromByTier = new Map<string, number>();
  for (const r of rules) {
    if (r.dayType === "special") continue;
    fromByTier.set(r.tier, Math.min(fromByTier.get(r.tier) ?? Infinity, r.fee));
  }
  const tierBookable = new Map(venue.tiers.map((t) => [t.id, t.bookable]));

  const tables: RoomTable[] = venue.tables.map((t) => {
    const row = byCode.get(t.id);
    const tier = row?.tier && tierBookable.has(row.tier) ? row.tier : t.tier;
    const bookable = row ? row.bookable : (t.bookable ?? tierBookable.get(t.tier) ?? false);
    const photoId = row ? row.photoId : t.photoId;
    const attributes = (row ? row.attributes : t.attributes).slice(0, 3) as RoomTable["attributes"];
    return {
      ...t,
      tier,
      attributes,
      photoId,
      bookable,
      fromCents: bookable ? (fromByTier.get(tier) ?? null) : null,
      image: bookable ? seatViewImage(venue.id, { id: t.id, photoId }) : null,
    };
  });

  return { data: { venue, tables, modelUrl: venueModelUrl(venueId) }, live: vrows[0]?.live ?? false };
}
