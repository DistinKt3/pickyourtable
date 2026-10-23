import { planOrientation, PORTRAIT_ASPECT } from "@/lib/room/orientation";
import { bearing, deg, norm, rad, ring, seatView, siteBounds, type Vec3, verticalFovForAspect } from "@/lib/venue/geometry";
import type { Venue, VenueTable } from "@/lib/venue/schema";

/**
 * Camera math for the diorama, kept free of three.js so it can be tested directly.
 * Angles are degrees. `pitch` is how far the camera looks down from horizontal
 * (equivalently, how high it sits above its target): the orbit keeps it in 25 to 70.
 */

export const ORBIT_FOV = 35;
export const PITCH_MIN = 25;
export const PITCH_MAX = 70;
export const DEFAULT_PITCH = 50;
/** How far ahead of the eye the orbit target sits while seated. */
export const SIT_LOOK_DISTANCE = 4;
export const MIN_DISTANCE = 3.2;
/** Intent-driven moves: exactly this long, eased in and out. */
export const MOVE_MS = 520;

export interface Pose {
  position: Vec3;
  target: Vec3;
  /** Vertical field of view. */
  fov: number;
  /**
   * Where the target lands on screen, in NDC (-1 bottom, +1 top). Applied with a view
   * offset, so orbiting still pivots on the target.
   */
  screenY: number;
}

export interface Margins {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

export function clampPitch(p: number): number {
  return Math.min(PITCH_MAX, Math.max(PITCH_MIN, p));
}

/** Polar angle limits for camera-controls (measured from straight up), in radians. */
export function polarLimits(): { min: number; max: number } {
  return { min: rad(90 - PITCH_MAX), max: rad(90 - PITCH_MIN) };
}

export function orbitPosition(target: Vec3, bearingDeg: number, pitchDeg: number, distance: number): Vec3 {
  const f = bearing(bearingDeg);
  const p = rad(pitchDeg);
  return {
    x: target.x - f.x * Math.cos(p) * distance,
    y: target.y + Math.sin(p) * distance,
    z: target.z - f.z * Math.cos(p) * distance,
  };
}

export function pitchOf(position: Vec3, target: Vec3): number {
  const d = Math.hypot(position.x - target.x, position.y - target.y, position.z - target.z);
  if (d === 0) return 0;
  return deg(Math.asin((position.y - target.y) / d));
}

/** Compass bearing the camera looks toward, on the floor. */
export function bearingOf(position: Vec3, target: Vec3): number {
  return norm(deg(Math.atan2(target.x - position.x, -(target.z - position.z))));
}

export function distanceOf(a: Vec3, b: Vec3): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

interface Basis {
  f: Vec3;
  r: Vec3;
  u: Vec3;
}

function basis(position: Vec3, target: Vec3): Basis {
  const fx = target.x - position.x;
  const fy = target.y - position.y;
  const fz = target.z - position.z;
  const fl = Math.hypot(fx, fy, fz);
  const f = { x: fx / fl, y: fy / fl, z: fz / fl };
  // r = f x up(0,1,0)
  let r = { x: -f.z, y: 0, z: f.x };
  const rl = Math.hypot(r.x, r.z) || 1;
  r = { x: r.x / rl, y: 0, z: r.z / rl };
  // u = r x f
  const u = { x: r.y * f.z - r.z * f.y, y: r.z * f.x - r.x * f.z, z: r.x * f.y - r.y * f.x };
  return { f, r, u };
}

/** Projects world points to NDC for a camera at `position` looking at `target` (no view offset). */
export function projectAll(
  points: Vec3[],
  position: Vec3,
  target: Vec3,
  fovDeg: number,
  aspect: number,
): { x: number; y: number }[] {
  const { f, r, u } = basis(position, target);
  const tanV = Math.tan(rad(fovDeg) / 2);
  const tanH = tanV * aspect;
  return points.map((p) => {
    const dx = p.x - position.x;
    const dy = p.y - position.y;
    const dz = p.z - position.z;
    const z = Math.max(1e-3, dx * f.x + dy * f.y + dz * f.z);
    return { x: (dx * r.x + dy * r.y + dz * r.z) / (z * tanH), y: (dx * u.x + dy * u.y + dz * u.z) / (z * tanV) };
  });
}

function extents(pts: { x: number; y: number }[]) {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of pts) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
  }
  return { minX, maxX, minY, maxY };
}

/** The box the plan must fill: every table ring, the room and outdoor areas, wall-high. */
export function sitePoints(venue: Venue): Vec3[] {
  const flat: { x: number; z: number }[] = [];
  const W = venue.room.width;
  const D = venue.room.depth;
  const t = 0.2;
  flat.push({ x: -t, z: -t }, { x: W + t, z: -t }, { x: W + t, z: D + t }, { x: -t, z: D + t });
  for (const w of venue.walls) flat.push({ x: w.from[0], z: w.from[1] }, { x: w.to[0], z: w.to[1] });
  // Outdoor areas count when guests sit there; empty lawn and promenade fade out instead.
  for (const a of venue.areas) {
    const xs = a.polygon.map((p) => p[0]);
    const zs = a.polygon.map((p) => p[1]);
    const hasTable = venue.tables.some(
      (tb) => tb.x >= Math.min(...xs) && tb.x <= Math.max(...xs) && tb.z >= Math.min(...zs) && tb.z <= Math.max(...zs),
    );
    if (hasTable) for (const p of a.polygon) flat.push({ x: p[0], z: p[1] });
  }
  for (const f of venue.fixtures) {
    const r = rad(f.rotation);
    for (const [u, v] of [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ] as const) {
      const lx = (u * f.width) / 2;
      const lz = (v * f.depth) / 2;
      flat.push({ x: f.x + lx * Math.cos(r) - lz * Math.sin(r), z: f.z + lx * Math.sin(r) + lz * Math.cos(r) });
    }
  }
  for (const tb of venue.tables) {
    const rg = ring(tb);
    const reach = rg.kind === "circle" ? rg.r : Math.hypot(rg.width, rg.depth) / 2;
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      flat.push({ x: rg.x + Math.cos(a) * reach, z: rg.z + Math.sin(a) * reach });
    }
  }
  const pts: Vec3[] = [];
  for (const p of flat) pts.push({ x: p.x, y: 0, z: p.z }, { x: p.x, y: venue.room.wallHeight, z: p.z });
  return pts;
}

/**
 * Fits points into the viewport (inside `margins`, fractions of the viewport) for a
 * fixed bearing and pitch, moving the target on the floor so the content is centered
 * in the margin box.
 */
export function fitPose(
  points: Vec3[],
  bearingDeg: number,
  pitchDeg: number,
  fovDeg: number,
  aspect: number,
  margins: Margins,
): Pose {
  let tx = 0;
  let tz = 0;
  for (const p of points) {
    tx += p.x;
    tz += p.z;
  }
  let target: Vec3 = { x: tx / points.length, y: 0, z: tz / points.length };
  const xL = -1 + 2 * margins.left;
  const xR = 1 - 2 * margins.right;
  const yB = -1 + 2 * margins.bottom;
  const yT = 1 - 2 * margins.top;
  const g = bearing(bearingDeg);
  const sinP = Math.sin(rad(pitchDeg));
  const tanV = Math.tan(rad(fovDeg) / 2);
  const tanH = tanV * aspect;
  let distance = 60;
  for (let i = 0; i < 80; i++) {
    const position = orbitPosition(target, bearingDeg, pitchDeg, distance);
    const e = extents(projectAll(points, position, target, fovDeg, aspect));
    const scale = Math.max((e.maxX - e.minX) / (xR - xL), (e.maxY - e.minY) / (yT - yB));
    const cx = (e.minX + e.maxX) / 2 - (xL + xR) / 2;
    const cy = (e.minY + e.maxY) / 2 - (yB + yT) / 2;
    const { r } = basis(position, target);
    const sx = cx * distance * tanH;
    const sz = (cy * distance * tanV) / Math.max(0.2, sinP);
    target = { x: target.x + r.x * sx + g.x * sz, y: 0, z: target.z + r.z * sx + g.z * sz };
    distance *= 1 + (scale - 1) * 0.85;
    if (Math.abs(scale - 1) < 1e-5 && Math.abs(cx) < 1e-5 && Math.abs(cy) < 1e-5) break;
  }
  return { position: orbitPosition(target, bearingDeg, pitchDeg, distance), target, fov: fovDeg, screenY: 0 };
}

/** Margins for the plan: room for the sticky header above and a little air below. */
export function overviewMargins(aspect: number): Margins {
  return aspect < PORTRAIT_ASPECT
    ? { top: 0.1, bottom: 0.05, left: 0.05, right: 0.05 }
    : { top: 0.12, bottom: 0.07, left: 0.05, right: 0.05 };
}

/**
 * The default camera: a three-quarter view at 35 degrees, looking toward the plan's
 * screen-up bearing (`planOrientation`), framing the whole site for this aspect.
 */
export function defaultPose(venue: Venue, aspect: number): Pose & { bearing: number; pitch: number } {
  const b = planOrientation(venue, aspect);
  const pitch = defaultPitch(aspect);
  const pose = fitPose(sitePoints(venue), b, pitch, ORBIT_FOV, aspect, overviewMargins(aspect));
  return { ...pose, bearing: b, pitch };
}

/** Portrait screens look a little more from above, so the long room fills the height. */
export function defaultPitch(aspect: number): number {
  return aspect < PORTRAIT_ASPECT ? DEFAULT_PITCH + 10 : DEFAULT_PITCH;
}

/** Distance limits: close enough to read a table, never past the whole site. */
export function distanceLimits(venue: Venue, aspect: number): { min: number; max: number } {
  const d = distanceOf(defaultPose(venue, aspect).position, defaultPose(venue, aspect).target);
  return { min: MIN_DISTANCE, max: d * 1.3 };
}

/** Where the target may roam: the site, on the floor. */
export function targetBounds(venue: Venue): { min: Vec3; max: Vec3 } {
  const b = siteBounds(venue);
  return { min: { x: b.minX, y: 0, z: b.minZ }, max: { x: b.maxX, y: 1, z: b.maxZ } };
}

/** The visible band of the screen when a table is selected: portrait phones lose the bottom 45% to the card. */
export function frameRegion(aspect: number): { top: number; bottom: number; side: number } {
  return aspect < PORTRAIT_ASPECT ? { top: 0.1, bottom: 0.47, side: 0.06 } : { top: 0.13, bottom: 0.14, side: 0.1 };
}

/** Radius around a table that `frame` keeps in view, so its neighbors show too. */
export function frameRadius(table: VenueTable): number {
  const r = ring(table);
  const reach = r.kind === "circle" ? r.r : Math.hypot(r.width, r.depth) / 2;
  return Math.max(2.2, reach + 1.3);
}

/**
 * Frames one table and its neighbors: the table stays the orbit pivot, the bearing
 * is kept, the pitch is eased into a comfortable band, and the table lands in the
 * middle of the part of the screen the card leaves clear.
 */
export function framePose(table: VenueTable, aspect: number, currentBearing: number, currentPitch: number): Pose {
  const target: Vec3 = { x: table.x, y: 0.35, z: table.z };
  const pitch = Math.min(60, Math.max(42, currentPitch));
  const region = frameRegion(aspect);
  const yT = 1 - 2 * region.top;
  const yB = -1 + 2 * region.bottom;
  const screenY = (yT + yB) / 2;
  const halfH = (yT - yB) / 2;
  const halfW = 1 - 2 * region.side;
  const radius = frameRadius(table);
  const pts: Vec3[] = [];
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    for (const y of [0, 1]) pts.push({ x: table.x + Math.cos(a) * radius, y, z: table.z + Math.sin(a) * radius });
  }
  // Binary search for the closest distance where the disc fits around the pivot.
  let lo = MIN_DISTANCE;
  let hi = 200;
  for (let i = 0; i < 50; i++) {
    const mid = (lo + hi) / 2;
    const position = orbitPosition(target, currentBearing, pitch, mid);
    const fits = projectAll(pts, position, target, ORBIT_FOV, aspect).every(
      (p) => Math.abs(p.x) <= halfW && Math.abs(p.y) <= halfH,
    );
    if (fits) hi = mid;
    else lo = mid;
  }
  return { position: orbitPosition(target, currentBearing, pitch, hi), target, fov: ORBIT_FOV, screenY };
}

/** "Sit here": the eye at 1.15 m over the main seat, facing the table's view, with the 26 mm lens. */
export function sitPose(table: VenueTable, aspect: number): Pose {
  const v = seatView(table);
  const target = {
    x: v.position.x + v.direction.x * SIT_LOOK_DISTANCE,
    y: v.position.y + v.direction.y * SIT_LOOK_DISTANCE,
    z: v.position.z + v.direction.z * SIT_LOOK_DISTANCE,
  };
  return { position: { ...v.position }, target, fov: verticalFovForAspect(aspect), screenY: 0 };
}

/** Ease-in-out for intent moves. */
export function easeInOut(t: number): number {
  const x = Math.min(1, Math.max(0, t));
  return x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2;
}

/** Shortest signed angle from a to b, degrees. */
export function shortestAngle(a: number, b: number): number {
  return ((b - a + 540) % 360) - 180;
}

/**
 * A pose partway through a move. Orbit-to-orbit moves interpolate around the target
 * (bearing, pitch, distance), so the room swings instead of the camera cutting a chord
 * through it; moves into or out of a seat interpolate eye and target directly.
 */
export function interpolatePose(from: Pose, to: Pose, t: number, mode: "orbit" | "direct"): Pose {
  const k = easeInOut(t);
  const lerp = (a: number, b: number) => a + (b - a) * k;
  const lerpV = (a: Vec3, b: Vec3): Vec3 => ({ x: lerp(a.x, b.x), y: lerp(a.y, b.y), z: lerp(a.z, b.z) });
  const target = lerpV(from.target, to.target);
  const fov = lerp(from.fov, to.fov);
  const screenY = lerp(from.screenY, to.screenY);
  if (mode === "direct") return { position: lerpV(from.position, to.position), target, fov, screenY };
  const b0 = bearingOf(from.position, from.target);
  const b1 = bearingOf(to.position, to.target);
  const bearingNow = b0 + shortestAngle(b0, b1) * k;
  const pitchNow = lerp(pitchOf(from.position, from.target), pitchOf(to.position, to.target));
  const d0 = distanceOf(from.position, from.target);
  const d1 = distanceOf(to.position, to.target);
  // Distance eases in log space so long zooms feel even.
  const dist = Math.exp(Math.log(d0) + (Math.log(d1) - Math.log(d0)) * k);
  return { position: orbitPosition(target, bearingNow, pitchNow, dist), target, fov, screenY };
}
