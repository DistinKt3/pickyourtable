import {
  labelAnchor,
  type Ring,
  ring,
  rotationY,
  type Seat,
  seats,
  type TableSize,
  tableSize,
  type Vec2,
  type Vec3,
} from "@/lib/venue/geometry";
import type { Fixture, Venue, VenueTable } from "@/lib/venue/schema";

/**
 * Where every table, chair, ring and label goes, derived only from
 * `lib/venue/geometry.ts`. Pure data, no three.js, so the layout-truth tests can run
 * it directly. The scene builds its meshes from these placements and nothing else.
 */

export interface ChairPlacement {
  /** World position of the seat (exactly `seats(table)`). */
  x: number;
  z: number;
  /** Compass bearing the seated guest faces. */
  facing: number;
  /** three.js rotation.y so the chair's local -z faces `facing`. */
  rotationY: number;
  main: boolean;
}

export interface TablePlacement {
  code: string;
  /** World position of the table group: exactly (x, 0, z) from venue.json. */
  position: Vec3;
  /** three.js rotation.y of the table group: exactly `rotationY(table.rotation)`. */
  rotationY: number;
  size: TableSize;
  /** Free-standing chairs. */
  chairs: ChairPlacement[];
  /** Seats on a fixed bench: the booth's own bench, or a banquette fixture. */
  benchSeats: Seat[];
  ring: Ring;
  label: Vec3;
}

/** A seat sits on a banquette fixture when it falls on or just in front of its cushion. */
export function seatOnBanquette(seat: Vec2, fixtures: Fixture[]): Fixture | null {
  for (const f of fixtures) {
    if (f.kind !== "banquette") continue;
    const r = (-f.rotation * Math.PI) / 180;
    const dx = seat.x - f.x;
    const dz = seat.z - f.z;
    // Into the fixture's local frame (its rotation is a compass bearing).
    const u = dx * Math.cos(r) - dz * Math.sin(r);
    const v = dx * Math.sin(r) + dz * Math.cos(r);
    const reach = 0.32;
    if (Math.abs(u) <= f.width / 2 + reach && Math.abs(v) <= f.depth / 2 + reach) return f;
  }
  return null;
}

export function tablePlacement(table: VenueTable, venue: Pick<Venue, "fixtures">): TablePlacement {
  const all = seats(table);
  const chairs: ChairPlacement[] = [];
  const benchSeats: Seat[] = [];
  for (const s of all) {
    if (s.kind === "bench" || seatOnBanquette(s, venue.fixtures)) {
      benchSeats.push(s);
      continue;
    }
    chairs.push({ x: s.x, z: s.z, facing: s.facing, rotationY: rotationY(s.facing), main: s.main });
  }
  return {
    code: table.id,
    position: { x: table.x, y: 0, z: table.z },
    rotationY: rotationY(table.rotation),
    size: tableSize(table),
    chairs,
    benchSeats,
    ring: ring(table),
    label: labelAnchor(table),
  };
}

export function tablePlacements(venue: Venue): TablePlacement[] {
  return venue.tables.map((t) => tablePlacement(t, venue));
}

/**
 * A world point expressed in a table group's local frame (inverse of the group's
 * translation and rotation.y), used to merge chairs into the table's mesh.
 */
export function worldToLocal(p: TablePlacement, x: number, z: number): Vec2 {
  const dx = x - p.position.x;
  const dz = z - p.position.z;
  const c = Math.cos(p.rotationY);
  const s = Math.sin(p.rotationY);
  // Inverse of three's Y rotation: x' = c*x - s*z ; z' = s*x + c*z
  return { x: c * dx - s * dz, z: s * dx + c * dz };
}

/** Forward transform of `worldToLocal`, used by tests and the hit proxies. */
export function localToWorldPoint(p: TablePlacement, x: number, z: number): Vec2 {
  const c = Math.cos(p.rotationY);
  const s = Math.sin(p.rotationY);
  return { x: p.position.x + c * x + s * z, z: p.position.z - s * x + c * z };
}
