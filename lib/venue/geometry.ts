import type { Venue, VenueTable } from "./schema";

/**
 * Pure layout math shared by every renderer. The 3D scene, the 2D plan, the seat
 * renders and the layout-truth test all derive positions from these functions, so
 * they cannot disagree about where a table is.
 */

export const EYE_HEIGHT = 1.15;
export const TABLE_HEIGHT = 0.75;
export const SEAT_HEIGHT = 0.45;
export const CHAIR_GAP = 0.3;

/** 26 mm on a 36 x 24 mm full-frame sensor (PRD quality bar, seat view). */
export const SEAT_VIEW_FOCAL_MM = 26;
const SENSOR_W = 36;
const SENSOR_H = 24;

export const deg = (r: number) => (r * 180) / Math.PI;
export const rad = (d: number) => (d * Math.PI) / 180;

export const seatViewFov = {
  horizontal: deg(2 * Math.atan(SENSOR_W / 2 / SEAT_VIEW_FOCAL_MM)),
  vertical: deg(2 * Math.atan(SENSOR_H / 2 / SEAT_VIEW_FOCAL_MM)),
  diagonal: deg(2 * Math.atan(Math.hypot(SENSOR_W, SENSOR_H) / 2 / SEAT_VIEW_FOCAL_MM)),
};

/** Seat renders are 3:2, the same frame as the 26 mm photo standard. */
export const SEAT_VIEW_ASPECT = 3 / 2;

/**
 * Vertical field of view that keeps the 26 mm diagonal at any aspect ratio, so a
 * portrait phone gets the same lens, never an ultra-wide.
 */
export function verticalFovForAspect(aspect: number): number {
  const tanDiag = Math.tan(rad(seatViewFov.diagonal) / 2);
  const tanV = tanDiag / Math.sqrt(1 + aspect * aspect);
  return deg(2 * Math.atan(tanV));
}

export interface Vec2 {
  x: number;
  z: number;
}
export interface Vec3 extends Vec2 {
  y: number;
}

/** Unit vector on the floor for a compass bearing (0 = north = -z, 90 = east = +x). */
export function bearing(degrees: number): Vec2 {
  const r = rad(degrees);
  return { x: Math.sin(r), z: -Math.cos(r) };
}

/** Three.js rotation.y for an object whose local forward (-z) should face `degrees`. */
export function rotationY(degrees: number): number {
  return -rad(degrees);
}

export function round(n: number, places = 4): number {
  const f = 10 ** places;
  return Math.round(n * f) / f;
}

export interface TableSize {
  width: number;
  depth: number;
}

export function tableSize(t: Pick<VenueTable, "shape" | "seats" | "width" | "depth">): TableSize {
  if (t.width && t.depth) return { width: t.width, depth: t.depth };
  switch (t.shape) {
    case "square":
      return t.seats <= 2 ? { width: 0.7, depth: 0.7 } : { width: 0.85, depth: 0.85 };
    case "round": {
      const d = t.seats <= 2 ? 0.7 : t.seats <= 4 ? 1.0 : 1.3;
      return { width: d, depth: d };
    }
    case "rect":
      return t.seats <= 4 ? { width: 1.2, depth: 0.75 } : { width: 1.8, depth: 0.8 };
    case "booth":
      return { width: 0.9, depth: 0.9 };
    case "counter":
      return { width: 1.4, depth: 0.55 };
  }
}

export interface Seat extends Vec2 {
  /** Compass bearing the seated guest faces. */
  facing: number;
  kind: "chair" | "bench";
  main: boolean;
}

/** World position of a point given in the table's local frame (u right, v forward). */
export function localToWorld(t: Pick<VenueTable, "x" | "z" | "rotation">, u: number, v: number): Vec2 {
  const f = bearing(t.rotation);
  const r = bearing(t.rotation + 90);
  return { x: t.x + r.x * u + f.x * v, z: t.z + r.z * u + f.z * v };
}

/** Booth bench, measured from the table edge: seat front, seat center, outside of the back. */
export const BOOTH_SEAT_INNER = 0.12;
export const BOOTH_SEAT_RADIUS_EXTRA = 0.33;
export const BOOTH_OUTER = 0.62;
export const BOOTH_ARC_DEGREES = 200;

/** Every seat at a table, in world coordinates. Exactly one is the main seat. */
export function seats(t: VenueTable): Seat[] {
  const { width: w, depth: d } = tableSize(t);
  const out: Seat[] = [];
  const at = (u: number, v: number, facingOffset: number, main = false, kind: Seat["kind"] = "chair") => {
    const p = localToWorld(t, u, v);
    out.push({ x: p.x, z: p.z, facing: norm(t.rotation + facingOffset), kind, main });
  };
  /** A seat on a circle around the center, at bearing `a` relative to the table's forward. */
  const onCircle = (a: number, r: number, main: boolean, kind: Seat["kind"]) => {
    const dir = bearing(a);
    // Facing the center: the opposite of the offset direction.
    at(dir.x * r, -dir.z * r, a + 180, main, kind);
  };
  const back = -(d / 2 + CHAIR_GAP);
  const front = d / 2 + CHAIR_GAP;

  switch (t.shape) {
    case "square": {
      at(0, back, 0, true);
      if (t.seats >= 2) at(0, front, 180);
      if (t.seats >= 3) at(-(w / 2 + CHAIR_GAP), 0, 90);
      if (t.seats >= 4) at(w / 2 + CHAIR_GAP, 0, 270);
      break;
    }
    case "rect": {
      const perSide = Math.min(2, Math.ceil(t.seats / 2));
      const backCount = perSide;
      const frontCount = Math.min(perSide, t.seats - backCount);
      for (let i = 0; i < backCount; i++) at(spread(i, backCount, w), back, 0, i === 0);
      for (let i = 0; i < frontCount; i++) at(spread(i, frontCount, w), front, 180);
      const rest = t.seats - backCount - frontCount;
      if (rest >= 1) at(-(w / 2 + CHAIR_GAP), 0, 90);
      if (rest >= 2) at(w / 2 + CHAIR_GAP, 0, 270);
      break;
    }
    case "round": {
      const r = w / 2 + CHAIR_GAP;
      for (let i = 0; i < t.seats; i++) onCircle(180 + (i * 360) / t.seats, r, i === 0, "chair");
      break;
    }
    case "booth": {
      // Seats spread along the curved bench; the main seat is the one nearest the
      // middle of the curve, looking straight out of the booth.
      const r = w / 2 + BOOTH_SEAT_RADIUS_EXTRA;
      const half = BOOTH_ARC_DEGREES / 2 - 25;
      const angles =
        t.seats === 1 ? [180] : Array.from({ length: t.seats }, (_, i) => 180 - half + (i * 2 * half) / (t.seats - 1));
      let best = 0;
      angles.forEach((a, i) => {
        if (Math.abs(a - 180) < Math.abs(angles[best]! - 180)) best = i;
      });
      angles.forEach((a, i) => onCircle(a, r, i === best, "bench"));
      break;
    }
    case "counter": {
      for (let i = 0; i < t.seats; i++) at(spread(i, t.seats, w), back, 0, i === 0);
      break;
    }
  }
  return out;
}

function spread(i: number, count: number, length: number): number {
  if (count <= 1) return 0;
  const step = length / count;
  return -length / 2 + step * (i + 0.5);
}

export function norm(degrees: number): number {
  return ((degrees % 360) + 360) % 360;
}

export function angleDiff(a: number, b: number): number {
  return ((a - b + 540) % 360) - 180;
}

export function mainSeat(t: VenueTable): Seat {
  const s = seats(t).find((x) => x.main);
  if (!s) throw new Error(`table ${t.id} has no main seat`);
  return s;
}

export interface SeatView {
  /** Eye position in world meters (y is up). */
  position: Vec3;
  yaw: number;
  pitch: number;
  /** Unit look direction in world space. */
  direction: Vec3;
}

/** The camera for the view from the main seat: 1.15 m eye height, facing `view`. */
export function seatView(t: VenueTable): SeatView {
  const s = mainSeat(t);
  // A seated eye sits a little ahead of the seat center, toward the table.
  const lean = bearing(s.facing);
  const position = { x: s.x + lean.x * 0.08, y: EYE_HEIGHT, z: s.z + lean.z * 0.08 };
  const f = bearing(t.view.yaw);
  const p = rad(t.view.pitch);
  const direction = { x: f.x * Math.cos(p), y: Math.sin(p), z: f.z * Math.cos(p) };
  return { position, yaw: t.view.yaw, pitch: t.view.pitch, direction };
}

export type Ring =
  | { kind: "circle"; x: number; z: number; r: number }
  | { kind: "rect"; x: number; z: number; width: number; depth: number; rotation: number; corner: number };

const RING_MARGIN = 0.14;
const CHAIR_HALF = 0.24;

/** The floor ring that marks a table's state; it encloses the table and its seats. */
export function ring(t: VenueTable): Ring {
  const { width: w, depth: d } = tableSize(t);
  if (t.shape === "counter") {
    const width = w + 0.16;
    const depth = d + CHAIR_GAP + CHAIR_HALF * 2 + 0.16;
    // Center the ring between the counter and its seats.
    const c = localToWorld(t, 0, -(CHAIR_GAP + CHAIR_HALF) / 2 - 0.04);
    return { kind: "rect", x: c.x, z: c.z, width, depth, rotation: t.rotation, corner: 0.22 };
  }
  if (t.shape === "booth") return { kind: "circle", x: t.x, z: t.z, r: w / 2 + BOOTH_OUTER + 0.1 };
  let r = 0;
  for (const s of seats(t)) r = Math.max(r, Math.hypot(s.x - t.x, s.z - t.z) + CHAIR_HALF);
  r = Math.max(r, Math.hypot(w, d) / 2);
  return { kind: "circle", x: t.x, z: t.z, r: r + RING_MARGIN };
}

/** Where the label floats: above the table, in world meters. */
export function labelAnchor(t: VenueTable): Vec3 {
  return { x: t.x, y: TABLE_HEIGHT + 0.25, z: t.z };
}

export interface Bounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export function bounds(points: Vec2[]): Bounds {
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minZ = Math.min(minZ, p.z);
    maxZ = Math.max(maxZ, p.z);
  }
  return { minX, maxX, minZ, maxZ };
}

/** Everything the guest can see on the plan: the room, outdoor areas and all furniture. */
export function siteBounds(v: Venue): Bounds {
  const pts: Vec2[] = [
    { x: 0, z: 0 },
    { x: v.room.width, z: v.room.depth },
  ];
  for (const w of v.walls) pts.push({ x: w.from[0], z: w.from[1] }, { x: w.to[0], z: w.to[1] });
  for (const a of v.areas) {
    if (a.kind === "promenade") continue;
    for (const p of a.polygon) pts.push({ x: p[0], z: p[1] });
  }
  for (const t of v.tables) {
    const r = ring(t);
    const reach = r.kind === "circle" ? r.r : Math.hypot(r.width, r.depth) / 2;
    pts.push({ x: t.x - reach, z: t.z - reach }, { x: t.x + reach, z: t.z + reach });
  }
  return bounds(pts);
}

export function boundsCenter(b: Bounds): Vec2 {
  return { x: (b.minX + b.maxX) / 2, z: (b.minZ + b.maxZ) / 2 };
}

/** Distance between two tables on the floor, used to rank similar tables. */
export function tableDistance(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

export function polygonCentroid(poly: [number, number][]): Vec2 {
  let x = 0;
  let z = 0;
  for (const p of poly) {
    x += p[0];
    z += p[1];
  }
  return { x: x / poly.length, z: z / poly.length };
}

/** Does any part of two rings overlap? Used by the schema sanity test. */
export function ringsOverlap(a: Ring, b: Ring): boolean {
  const ra = a.kind === "circle" ? a.r : Math.min(a.width, a.depth) / 2;
  const rb = b.kind === "circle" ? b.r : Math.min(b.width, b.depth) / 2;
  return Math.hypot(a.x - b.x, a.z - b.z) < ra + rb - 0.05;
}
