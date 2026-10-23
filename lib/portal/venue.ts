import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { venue as venueRow } from "@/db/schema";
import { ApiError } from "@/lib/http/api";
import { loadVenue } from "@/lib/venue/load";
import type { Venue } from "@/lib/venue/schema";

/** The signed-in operator's venue: the database row (name, live) plus venue.json. */
export interface PortalVenue {
  id: string;
  name: string;
  timezone: string;
  live: boolean;
  wentLiveAt: Date | null;
  demo: boolean;
  brand: Venue["brand"];
  config: Venue;
}

export async function portalVenue(venueId: string): Promise<PortalVenue> {
  const [rows, config] = await Promise.all([db().select().from(venueRow).where(eq(venueRow.id, venueId)), loadVenue(venueId)]);
  const row = rows[0];
  if (!row) throw new ApiError(404, "venue_not_found", "This venue no longer exists.");
  return {
    id: row.id,
    name: row.name,
    timezone: row.timezone,
    live: row.live,
    wentLiveAt: row.wentLiveAt,
    demo: config.demo,
    brand: config.brand,
    config,
  };
}

/** CSS custom properties that carry the venue accent into the portal, as on the guest widget. */
export function accentStyle(brand: Venue["brand"]): Record<string, string> {
  return { "--accent": brand.accent, "--accent-dark": brand.accentDark, "--on-accent": brand.onAccent };
}
