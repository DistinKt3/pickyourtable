import {
  BOOTH_ARC_DEGREES,
  BOOTH_OUTER,
  BOOTH_SEAT_INNER,
  bearing,
  type Bounds,
  type Ring,
  rad,
  ring,
  seats,
  siteBounds,
  tableSize,
  type Vec2,
} from "@/lib/venue/geometry";
import type { Area, Venue, VenueTable, Wall } from "@/lib/venue/schema";

/**
 * Pure layout for the 2D plan. SVG user units are meters: world (x, z) is drawn at
 * SVG (x, z), so north is up before rotation. The whole plan is rotated so that
 * `bearing` points up the screen (see lib/room/orientation.ts).
 */

export interface PlanFrame {
  bearing: number;
  /** SVG rotate() angle in degrees (clockwise on screen). */
  rotate: number;
  viewBox: { x: number; y: number; w: number; h: number };
  aspect: number;
}

const WATER_HINT = 2.4;
const PAD = 0.5;

/** Bounds of what the plan shows: the site, plus a strip of the view (water) side. */
export function planBounds(venue: Venue): Bounds {
  const b = siteBounds(venue);
  const w = venue.surroundings.water;
  if (w) {
    if (w.side === "north") b.minZ = Math.min(b.minZ, w.at - WATER_HINT);
    if (w.side === "south") b.maxZ = Math.max(b.maxZ, w.at + WATER_HINT);
    if (w.side === "west") b.minX = Math.min(b.minX, w.at - WATER_HINT);
    if (w.side === "east") b.maxX = Math.max(b.maxX, w.at + WATER_HINT);
  }
  return { minX: b.minX - PAD, maxX: b.maxX + PAD, minZ: b.minZ - PAD, maxZ: b.maxZ + PAD };
}

export function rotatePoint(p: Vec2, degrees: number): { x: number; y: number } {
  const r = rad(degrees);
  const c = Math.cos(r);
  const s = Math.sin(r);
  return { x: p.x * c - p.z * s, y: p.x * s + p.z * c };
}

export function planFrame(venue: Venue, screenUpBearing: number): PlanFrame {
  const rotate = (360 - screenUpBearing) % 360;
  const b = planBounds(venue);
  const corners = [
    { x: b.minX, z: b.minZ },
    { x: b.maxX, z: b.minZ },
    { x: b.maxX, z: b.maxZ },
    { x: b.minX, z: b.maxZ },
  ].map((p) => rotatePoint(p, rotate));
  const xs = corners.map((c) => c.x);
  const ys = corners.map((c) => c.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  const w = Math.max(...xs) - x;
  const h = Math.max(...ys) - y;
  return { bearing: screenUpBearing, rotate, viewBox: { x, y, w, h }, aspect: w / h };
}

/** Position of a world point inside the plan box, as percentages (for HTML overlays). */
export function project(frame: PlanFrame, p: Vec2): { left: number; top: number } {
  const r = rotatePoint(p, frame.rotate);
  return {
    left: ((r.x - frame.viewBox.x) / frame.viewBox.w) * 100,
    top: ((r.y - frame.viewBox.y) / frame.viewBox.h) * 100,
  };
}

/* ------------------------------------------------------------- Shapes */

const f = (n: number) => Number(n.toFixed(3));

/** Outward unit normal of a wall, pointing away from the room's interior. */
function outward(venue: Venue, w: Wall): Vec2 {
  const dx = w.to[0] - w.from[0];
  const dz = w.to[1] - w.from[1];
  const len = Math.hypot(dx, dz) || 1;
  const n = { x: dz / len, z: -dx / len };
  const mid = { x: (w.from[0] + w.to[0]) / 2, z: (w.from[1] + w.to[1]) / 2 };
  const center = { x: venue.room.width / 2, z: venue.room.depth / 2 };
  const toCenter = { x: center.x - mid.x, z: center.z - mid.z };
  return n.x * toCenter.x + n.z * toCenter.z > 0 ? { x: -n.x, z: -n.z } : n;
}

export const WALL_THICKNESS = 0.2;

export interface WallShape {
  id: string;
  kind: Wall["kind"];
  /** Centerline of the drawn wall (offset outward by half its thickness). */
  x1: number;
  z1: number;
  x2: number;
  z2: number;
  /** Mullion or panel ticks along glass walls, as short segments. */
  ticks: { x1: number; z1: number; x2: number; z2: number }[];
}

export function wallShapes(venue: Venue): WallShape[] {
  return venue.walls.map((w) => {
    const n = outward(venue, w);
    const o = WALL_THICKNESS / 2;
    const a = { x: w.from[0] + n.x * o, z: w.from[1] + n.z * o };
    const b = { x: w.to[0] + n.x * o, z: w.to[1] + n.z * o };
    const ticks: WallShape["ticks"] = [];
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    const step = w.kind === "glass" ? 2.5 : w.kind === "sliding-door" ? 1.6 : 0;
    if (step && len > step) {
      const count = Math.round(len / step);
      for (let i = 1; i < count; i++) {
        const t = i / count;
        const p = { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t };
        ticks.push({ x1: f(p.x - n.x * o), z1: f(p.z - n.z * o), x2: f(p.x + n.x * o), z2: f(p.z + n.z * o) });
      }
    }
    if (w.kind === "doorway") {
      for (const p of [a, b]) {
        ticks.push({ x1: f(p.x - n.x * o), z1: f(p.z - n.z * o), x2: f(p.x + n.x * o), z2: f(p.z + n.z * o) });
      }
    }
    return { id: w.id, kind: w.kind, x1: f(a.x), z1: f(a.z), x2: f(b.x), z2: f(b.z), ticks };
  });
}

/** Wall corners: solid walls are drawn with square caps extended so corners close cleanly. */
export function polygonPath(points: [number, number][]): string {
  return `M${points.map((p) => `${f(p[0])} ${f(p[1])}`).join("L")}Z`;
}

export interface WaterShape {
  path: string;
  /** Faint wave lines across the water. */
  waves: { x1: number; z1: number; x2: number; z2: number }[];
}

export function waterShape(venue: Venue): WaterShape | null {
  const w = venue.surroundings.water;
  if (!w) return null;
  const big = 200;
  const rect: Record<string, [number, number][]> = {
    north: [
      [-big, -big],
      [big, -big],
      [big, w.at],
      [-big, w.at],
    ],
    south: [
      [-big, w.at],
      [big, w.at],
      [big, big],
      [-big, big],
    ],
    west: [
      [-big, -big],
      [w.at, -big],
      [w.at, big],
      [-big, big],
    ],
    east: [
      [w.at, -big],
      [big, -big],
      [big, big],
      [w.at, big],
    ],
  };
  const b = planBounds(venue);
  const waves: WaterShape["waves"] = [];
  const horizontal = w.side === "north" || w.side === "south";
  const sign = w.side === "north" || w.side === "west" ? -1 : 1;
  for (let i = 1; i <= 3; i++) {
    const d = w.at + sign * i * 0.7;
    const span = horizontal ? [b.minX, b.maxX] : [b.minZ, b.maxZ];
    const len = span[1]! - span[0]!;
    const start = span[0]! + len * (0.08 + 0.13 * i);
    const end = start + len * 0.22;
    waves.push(horizontal ? { x1: f(start), z1: f(d), x2: f(end), z2: f(d) } : { x1: f(d), z1: f(start), x2: f(d), z2: f(end) });
  }
  return { path: polygonPath(rect[w.side]!), waves };
}

/** Where to print an area's name: the point inside it farthest from any table or fixture. */
export function areaLabelPoint(venue: Venue, area: Area): Vec2 {
  const xs = area.polygon.map((p) => p[0]);
  const zs = area.polygon.map((p) => p[1]);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minZ = Math.min(...zs);
  const maxZ = Math.max(...zs);
  const obstacles: Vec2[] = [
    ...venue.tables.map((t) => ({ x: t.x, z: t.z })),
    ...venue.fixtures.map((x) => ({ x: x.x, z: x.z })),
  ];
  let best = { x: (minX + maxX) / 2, z: (minZ + maxZ) / 2 };
  let bestScore = -Infinity;
  const steps = 14;
  for (let i = 1; i < steps; i++) {
    for (let j = 1; j < steps; j++) {
      const p = { x: minX + ((maxX - minX) * i) / steps, z: minZ + ((maxZ - minZ) * j) / steps };
      if (!insidePolygon(p, area.polygon)) continue;
      const edge = Math.min(p.x - minX, maxX - p.x, p.z - minZ, maxZ - p.z);
      const clear = Math.min(...obstacles.map((o) => Math.hypot(o.x - p.x, o.z - p.z)), 99);
      const score = Math.min(clear, edge * 1.5);
      if (score > bestScore) {
        bestScore = score;
        best = p;
      }
    }
  }
  return best;
}

function insidePolygon(p: Vec2, poly: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i]!;
    const [xj, zj] = poly[j]!;
    if (zi > p.z !== zj > p.z && p.x < ((xj - xi) * (p.z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

/* ------------------------------------------------------------ Tables */

export interface TableShape {
  code: string;
  /** Table group transform: translate to (x, z), rotate to the table's bearing. */
  transform: string;
  top: { kind: "rect"; w: number; d: number; r: number } | { kind: "circle"; r: number };
  booth: { bench: string; back: string } | null;
  chairs: { transform: string }[];
  ring: Ring;
  /** Radius of the invisible tap target around the table, in meters. */
  hit: number;
}

function sectorPath(rIn: number, rOut: number, fromDeg: number, toDeg: number): string {
  // Local frame: forward is -y; a relative bearing a sits at (r sin a, -r cos a).
  const pt = (r: number, a: number) => {
    const d = bearing(a);
    return `${f(d.x * r)} ${f(d.z * r)}`;
  };
  const large = toDeg - fromDeg > 180 ? 1 : 0;
  return [
    `M${pt(rOut, fromDeg)}`,
    `A${f(rOut)} ${f(rOut)} 0 ${large} 1 ${pt(rOut, toDeg)}`,
    `L${pt(rIn, toDeg)}`,
    `A${f(rIn)} ${f(rIn)} 0 ${large} 0 ${pt(rIn, fromDeg)}`,
    "Z",
  ].join("");
}

export function tableShape(t: VenueTable): TableShape {
  const { width: w, depth: d } = tableSize(t);
  const r = ring(t);
  const top: TableShape["top"] =
    t.shape === "round" || t.shape === "booth"
      ? { kind: "circle", r: f(w / 2) }
      : { kind: "rect", w: f(w), d: f(d), r: t.shape === "counter" ? 0.04 : 0.07 };
  const half = BOOTH_ARC_DEGREES / 2;
  const booth =
    t.shape === "booth"
      ? {
          bench: sectorPath(w / 2 + BOOTH_SEAT_INNER, w / 2 + BOOTH_OUTER, 180 - half, 180 + half),
          back: sectorPath(w / 2 + BOOTH_OUTER - 0.12, w / 2 + BOOTH_OUTER, 180 - half, 180 + half),
        }
      : null;
  const chairs =
    t.shape === "booth" ? [] : seats(t).map((s) => ({ transform: `translate(${f(s.x)} ${f(s.z)}) rotate(${f(s.facing)})` }));
  const reach = r.kind === "circle" ? r.r : Math.max(r.width, r.depth) / 2;
  return {
    code: t.id,
    transform: `translate(${f(t.x)} ${f(t.z)}) rotate(${f(t.rotation)})`,
    top,
    booth,
    chairs,
    ring: r,
    hit: f(reach + 0.1),
  };
}

/** Reads a table group's transform back into world coordinates (layout-truth test). */
export function parseTransform(transform: string): { x: number; z: number; rotation: number } | null {
  const m = /translate\(([-\d.]+) ([-\d.]+)\) rotate\(([-\d.]+)\)/.exec(transform);
  if (!m) return null;
  return { x: Number(m[1]), z: Number(m[2]), rotation: Number(m[3]) };
}
