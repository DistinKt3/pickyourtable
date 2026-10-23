import type { Venue } from "@/lib/venue/schema";

/**
 * Which compass bearing points up the screen, shared by the 2D plan and the 3D
 * default camera so the plan that paints first and the 3D that fades in over it
 * agree.
 *
 * - Landscape: look toward the view (water, else the main glass wall): it reads at
 *   the back, the way a guest walks in and sees it.
 * - Portrait: look along the room with the view running down the right-hand side,
 *   so a tall phone screen holds the long room instead of a thin strip.
 */

export type Side = "north" | "east" | "south" | "west";
const SIDE_BEARING: Record<Side, number> = { north: 0, east: 90, south: 180, west: 270 };

export const PORTRAIT_ASPECT = 0.8;

/** The side of the room the guest wants to look at. */
export function viewSide(venue: Venue): Side {
  if (venue.surroundings.water) return venue.surroundings.water.side;
  let best: { side: Side; length: number } | null = null;
  for (const w of venue.walls) {
    if (w.kind !== "glass") continue;
    const length = Math.hypot(w.to[0] - w.from[0], w.to[1] - w.from[1]);
    const mx = (w.from[0] + w.to[0]) / 2;
    const mz = (w.from[1] + w.to[1]) / 2;
    const d = {
      north: Math.abs(mz),
      south: Math.abs(mz - venue.room.depth),
      west: Math.abs(mx),
      east: Math.abs(mx - venue.room.width),
    };
    const side = (Object.entries(d) as [Side, number][]).sort((a, b) => a[1] - b[1])[0]![0];
    if (!best || length > best.length) best = { side, length };
  }
  return best?.side ?? "north";
}

/** Compass bearing that is screen-up for a container of this aspect (width / height). */
export function planOrientation(venue: Venue, aspect: number): number {
  const view = SIDE_BEARING[viewSide(venue)];
  return aspect >= PORTRAIT_ASPECT ? view : (view + 270) % 360;
}
