import type { TableAvailability } from "@/lib/api/contracts";
import type { SeatViewImage } from "@/lib/venue/media";
import type { Venue, VenueTable } from "@/lib/venue/schema";

/**
 * What every room renderer (3D, 2D plan, list) receives. Geometry comes from
 * venue.json; tier, attributes, photo and bookable come from the database, where the
 * owner can change them.
 */
export interface RoomTable extends VenueTable {
  bookable: boolean;
  /** Lowest current fee for this table's tier, for "from $X" in browse mode. */
  fromCents: number | null;
  /** Seat view; null when the table is not bookable. */
  image: SeatViewImage | null;
}

export interface RoomData {
  venue: Venue;
  tables: RoomTable[];
  /** Optional venue model (PRD D-2); null builds the room from venue.json. */
  modelUrl: string | null;
}

export type VisualState = "available" | "taken" | "wrong_size" | "not_bookable";

/** Before a slot is chosen (browse mode) every bookable table reads as available. */
export function visualState(t: RoomTable, a: TableAvailability | undefined | null): VisualState {
  if (!t.bookable) return "not_bookable";
  if (!a) return "available";
  return a.state;
}

export function tierOf(venue: Venue, tierId: string) {
  return venue.tiers.find((t) => t.id === tierId) ?? venue.tiers[0]!;
}
