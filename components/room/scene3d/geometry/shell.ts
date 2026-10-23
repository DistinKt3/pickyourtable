import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { boundsCenter, siteBounds, rotationY, type Vec2 } from "@/lib/venue/geometry";
import type { Area, Fixture, Venue, Wall } from "@/lib/venue/schema";
import type { FloorKind, Palette } from "../palette";
import {
  arc,
  blob,
  block,
  empty,
  GLAZE,
  hash,
  lathe,
  LIFT,
  MATTE,
  merge,
  METAL,
  paint,
  PATTERN,
  place,
  planShape,
  post,
  type Rise,
  roundedRectShape,
  SATIN,
  slab,
  softBox,
  STEEL,
  STILL,
  stretch,
  type Surface,
  UPHOLSTERY,
} from "./util";

/**
 * The room shell from venue.json: floors from `areas`, cutaway walls from `walls`
 * (solid, glass, sliding door, doorway), fixtures, and the surroundings (ground,
 * quay, water). Walls carry rise weights so they can grow to the ceiling for seat
 * views without separate meshes.
 */

export const WALL_THICKNESS = 0.2;
const T = WALL_THICKNESS;
const SILL = 0.1;
const HEAD = 0.05;
const DOOR_HEAD = 2.25;
const SLIDER_HEAD = 2.45;
export const GROUND_Y = -0.04;
export const WATER_Y = -0.5;

export interface ShellGeometry {
  /** Floors, walls, fixtures: one clay mesh. */
  clay: THREE.BufferGeometry;
  /** Window and door glass, railing glass. */
  glass: THREE.BufferGeometry;
  /** Only while seated: ceiling, downlights, door headers, the kitchen hood. */
  sitOnly: THREE.BufferGeometry;
  /** Ground plane and quay, with vertex colors; fades into the page. */
  ground: THREE.BufferGeometry;
  water: THREE.BufferGeometry | null;
  shore: { x: number; z: number; dx: number; dz: number } | null;
  interiorRect: [number, number, number, number];
  fadeCenter: Vec2;
  /** Half the site's diagonal. */
  siteRadius: number;
  /** The site on the floor: minX, minZ, maxX, maxZ. */
  siteRect: [number, number, number, number];
}

interface Colors {
  palette: Palette;
  accent: string;
}

/* ------------------------------------------------------------------ Floors */

function pointInPolygon(p: Vec2, poly: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i]!;
    const [xj, zj] = poly[j]!;
    if (zi > p.z !== zj > p.z && p.x < ((xj - xi) * (p.z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

function polygonInside(inner: [number, number][], outer: [number, number][]): boolean {
  // Nudge each vertex toward the inner centroid so shared edges count as inside.
  let cx = 0;
  let cz = 0;
  for (const [x, z] of inner) {
    cx += x;
    cz += z;
  }
  cx /= inner.length;
  cz /= inner.length;
  return inner.every(([x, z]) => pointInPolygon({ x: x + (cx - x) * 0.01, z: z + (cz - z) * 0.01 }, outer));
}

const FLOOR_STYLE: Record<FloorKind, { top: number; thick: number; surface: Surface; pattern: (a: Area) => number }> = {
  dining: { top: 0, thick: 0.08, surface: { roughness: 0.82, metalness: 0 }, pattern: () => PATTERN.none },
  kitchen: { top: 0, thick: 0.08, surface: { roughness: 0.55, metalness: 0 }, pattern: () => PATTERN.tiles },
  service: { top: 0, thick: 0.08, surface: MATTE, pattern: () => PATTERN.none },
  terrace: {
    top: 0,
    thick: 0.07,
    surface: { roughness: 0.78, metalness: 0 },
    pattern: (a) => (longAxisZ(a) ? PATTERN.planks : PATTERN.boards),
  },
  promenade: { top: -0.02, thick: 0.05, surface: { roughness: 0.92, metalness: 0 }, pattern: () => PATTERN.pavers },
  garden: { top: -0.02, thick: 0.05, surface: { roughness: 0.98, metalness: 0 }, pattern: () => PATTERN.lawn },
};

function longAxisZ(a: Area): boolean {
  const xs = a.polygon.map((p) => p[0]);
  const zs = a.polygon.map((p) => p[1]);
  return Math.max(...zs) - Math.min(...zs) >= Math.max(...xs) - Math.min(...xs);
}

/** Top height of each area: nested areas (a kitchen inside the dining room) sit 6 mm proud. */
export function areaTops(venue: Venue): Map<string, number> {
  const tops = new Map<string, number>();
  for (const a of venue.areas) {
    let depth = 0;
    for (const b of venue.areas) if (b !== a && polygonInside(a.polygon, b.polygon)) depth++;
    tops.set(a.id, FLOOR_STYLE[a.kind].top + depth * 0.006);
  }
  return tops;
}

export function floorTopAt(venue: Venue, p: Vec2, tops = areaTops(venue)): number {
  let best = GROUND_Y;
  let found = false;
  for (const a of venue.areas) {
    if (!pointInPolygon(p, a.polygon)) continue;
    const t = tops.get(a.id) ?? 0;
    if (!found || t > best) best = t;
    found = true;
  }
  return best;
}

function floors(venue: Venue, c: Colors): THREE.BufferGeometry[] {
  const tops = areaTops(venue);
  return venue.areas.map((a) => {
    const style = FLOOR_STYLE[a.kind];
    const top = tops.get(a.id)!;
    const g = slab(planShape(a.polygon), style.thick, 0.012, 2);
    g.translate(0, top - style.thick, 0);
    return paint(g, c.palette.floor[a.kind], style.surface, { pattern: style.pattern(a) });
  });
}

/* ------------------------------------------------------------------- Walls */

interface Seg {
  wall: Wall;
  a: Vec2;
  b: Vec2;
  dir: Vec2;
  /** Unit normal pointing out of the room. */
  n: Vec2;
}

const near = (p: Vec2, q: Vec2) => Math.hypot(p.x - q.x, p.z - q.z) < 1e-4;

function segments(venue: Venue): Seg[] {
  const c = { x: venue.room.width / 2, z: venue.room.depth / 2 };
  return venue.walls.map((w) => {
    const a = { x: w.from[0], z: w.from[1] };
    const b = { x: w.to[0], z: w.to[1] };
    const len = Math.hypot(b.x - a.x, b.z - a.z) || 1;
    const dir = { x: (b.x - a.x) / len, z: (b.z - a.z) / len };
    let n = { x: -dir.z, z: dir.x };
    const mid = { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 };
    if ((c.x - mid.x) * n.x + (c.z - mid.z) * n.z > 0) n = { x: -n.x, z: -n.z };
    return { wall: w, a, b, dir, n };
  });
}

/** Where a wall's centerline ends at a joint: on the offset line, mitred at corners. */
function jointPoint(seg: Seg, p: Vec2, all: Seg[]): Vec2 {
  const other = all.find((s) => s !== seg && (near(s.a, p) || near(s.b, p)));
  const h = T / 2;
  if (!other) return { x: p.x + seg.n.x * h, z: p.z + seg.n.z * h };
  const cross = seg.dir.x * other.dir.z - seg.dir.z * other.dir.x;
  if (Math.abs(cross) < 1e-6) return { x: p.x + seg.n.x * h, z: p.z + seg.n.z * h };
  const k = h / (1 + seg.n.x * other.n.x + seg.n.z * other.n.z);
  return { x: p.x + (seg.n.x + other.n.x) * k, z: p.z + (seg.n.z + other.n.z) * k };
}

/**
 * Lays a part built along local +x (its length) onto a wall line. Parts are symmetric
 * across local z, so only the along-wall direction matters; `offsetOut` moves the part
 * across the wall in world space (positive is out of the room).
 */
function alongWall(geo: THREE.BufferGeometry, from: Vec2, dir: Vec2, n: Vec2, offsetAlong: number, offsetOut: number, y = 0) {
  // three's rotation.y maps local +x to (cos, 0, -sin).
  const ry = Math.atan2(-dir.z, dir.x);
  return place(geo, from.x + dir.x * offsetAlong + n.x * offsetOut, y, from.z + dir.z * offsetAlong + n.z * offsetOut, ry);
}

function walls(
  venue: Venue,
  c: Colors,
  out: { clay: THREE.BufferGeometry[]; glass: THREE.BufferGeometry[]; sit: THREE.BufferGeometry[] },
) {
  const H = venue.room.wallHeight;
  const C = venue.room.ceilingHeight;
  const p = c.palette;
  const segs = segments(venue);
  const piers: Vec2[] = [];
  const addPier = (q: Vec2) => {
    if (!piers.some((x) => near(x, q))) piers.push(q);
  };

  for (const s of segs) {
    const A = jointPoint(s, s.a, segs);
    const B = jointPoint(s, s.b, segs);
    addPier(A);
    addPier(B);
    const len = Math.hypot(B.x - A.x, B.z - A.z);
    // Faces of the opening (doorway, door) sit on the true wall line between the piers.
    const inner = Math.max(0, len - T);
    const start = T / 2;

    switch (s.wall.kind) {
      case "solid": {
        const body = block(len, H - T / 2, T);
        body.translate(len / 2, 0, 0);
        out.clay.push(paint(alongWall(body, A, s.dir, s.n, 0, 0), p.wall, MATTE, { rise: stretch(0, H - T / 2) }));
        const cap = new THREE.CylinderGeometry(T / 2, T / 2, len, 20, 1, true, 0, Math.PI);
        // Cylinder axis along local y; lay it along x with the half-round facing up.
        cap.rotateZ(Math.PI / 2);
        cap.translate(len / 2, H - T / 2, 0);
        out.clay.push(paint(alongWall(cap, A, s.dir, s.n, 0, 0), p.wallCap, MATTE, { rise: LIFT }));
        // Baseboard on the room side.
        const base = softBox(inner, 0.08, 0.014, 0.004, 2);
        base.translate(inner / 2, 0, 0);
        out.clay.push(paint(alongWall(base, A, s.dir, s.n, start, -T / 2 - 0.007), p.sill, SATIN));
        break;
      }
      case "glass": {
        const sill = softBox(len, SILL, T, 0.018, 4);
        sill.translate(len / 2, 0, 0);
        out.clay.push(paint(alongWall(sill, A, s.dir, s.n, 0, 0), p.sill, SATIN));
        const pane = new THREE.PlaneGeometry(inner, H - HEAD - SILL);
        pane.translate(inner / 2, SILL + (H - HEAD - SILL) / 2, 0);
        out.glass.push(glassPart(alongWall(pane, A, s.dir, s.n, start, 0), stretch(SILL, H - HEAD)));
        const count = Math.max(1, Math.round(inner / 1.85));
        for (let i = 1; i < count; i++) {
          const m = softBox(0.04, H - HEAD - SILL, 0.07, 0.008, 2);
          m.translate(0, SILL, 0);
          out.clay.push(
            paint(alongWall(m, A, s.dir, s.n, start + (inner * i) / count, 0), p.frame, METAL, { rise: stretch(SILL, H - HEAD) }),
          );
        }
        const head = softBox(len, HEAD, 0.09, 0.02, 4);
        head.translate(len / 2, H - HEAD, 0);
        out.clay.push(paint(alongWall(head, A, s.dir, s.n, 0, 0), p.frame, METAL, { rise: LIFT }));
        break;
      }
      case "sliding-door": {
        const track = softBox(inner, 0.012, 0.13, 0.004, 2);
        track.translate(inner / 2, 0, 0);
        out.clay.push(paint(alongWall(track, A, s.dir, s.n, start, 0), p.steelDark, STEEL));
        const panels = Math.max(2, Math.round(inner / 1.6));
        const pw = inner / panels;
        for (let i = 0; i < panels; i++) {
          const offOut = i % 2 === 0 ? -0.03 : 0.03;
          const x0 = start + pw * i - (i > 0 ? 0.02 : 0);
          const w = pw + (i > 0 && i < panels - 1 ? 0.04 : 0.02);
          const top = H - 0.04;
          for (const sx of [0.025, w - 0.025]) {
            const stile = softBox(0.05, top - 0.07, 0.045, 0.006, 2);
            stile.translate(sx, 0.07, 0);
            out.clay.push(paint(alongWall(stile, A, s.dir, s.n, x0, offOut), p.frame, METAL, { rise: stretch(0.07, top) }));
          }
          const bottom = softBox(w, 0.07, 0.045, 0.006, 2);
          bottom.translate(w / 2, 0.012, 0);
          out.clay.push(paint(alongWall(bottom, A, s.dir, s.n, x0, offOut), p.frame, METAL));
          const rail = softBox(w, 0.04, 0.045, 0.006, 2);
          rail.translate(w / 2, top, 0);
          out.clay.push(paint(alongWall(rail, A, s.dir, s.n, x0, offOut), p.frame, METAL, { rise: LIFT }));
          const pane = new THREE.PlaneGeometry(w - 0.1, top - 0.082);
          pane.translate(w / 2, 0.082 + (top - 0.082) / 2, 0);
          out.glass.push(glassPart(alongWall(pane, A, s.dir, s.n, x0, offOut), stretch(0.082, top)));
        }
        const header = block(inner, C - SLIDER_HEAD, T);
        header.translate(inner / 2, SLIDER_HEAD, 0);
        out.sit.push(paint(alongWall(header, A, s.dir, s.n, start, 0), p.wall, MATTE));
        break;
      }
      case "doorway": {
        const sill = softBox(inner, 0.012, T, 0.004, 2);
        sill.translate(inner / 2, 0, 0);
        out.clay.push(paint(alongWall(sill, A, s.dir, s.n, start, 0), p.stone, SATIN));
        const header = block(inner, C - DOOR_HEAD, T);
        header.translate(inner / 2, DOOR_HEAD, 0);
        out.sit.push(paint(alongWall(header, A, s.dir, s.n, start, 0), p.wall, MATTE));
        break;
      }
    }
  }

  // Round piers at every joint: they turn corners softly and finish door jambs.
  for (const q of piers) {
    const body = new THREE.CylinderGeometry(T / 2, T / 2, H - T / 2, 24, 1, true);
    body.translate(q.x, (H - T / 2) / 2, q.z);
    out.clay.push(paint(body, p.wall, MATTE, { rise: stretch(0, H - T / 2) }));
    const dome = new THREE.SphereGeometry(T / 2, 24, 8, 0, Math.PI * 2, 0, Math.PI / 2);
    dome.translate(q.x, H - T / 2, q.z);
    out.clay.push(paint(dome, p.wallCap, MATTE, { rise: LIFT }));
  }
}

function glassPart(geo: THREE.BufferGeometry, rise: Rise): THREE.BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo;
  for (const name of Object.keys(g.attributes)) if (name !== "position" && name !== "normal") g.deleteAttribute(name);
  const pos = g.attributes.position!;
  const w = new Float32Array(pos.count);
  for (let i = 0; i < pos.count; i++) {
    if (rise.kind === "lift") w[i] = 1;
    else if (rise.kind === "stretch") w[i] = Math.min(1, Math.max(0, (pos.getY(i) - rise.base) / (rise.top - rise.base)));
  }
  g.setAttribute("rise", new THREE.BufferAttribute(w, 1));
  return g;
}

/* ---------------------------------------------------------------- Fixtures */

/** Which side of a fixture's short axis faces the nearest room wall: its back. */
function backSign(f: Fixture, venue: Venue): { longX: boolean; sign: number } {
  const longX = f.width >= f.depth;
  const half = (longX ? f.depth : f.width) / 2;
  const ry = rotationY(f.rotation);
  const toWorld = (u: number, v: number) => ({
    x: f.x + Math.cos(ry) * u + Math.sin(ry) * v,
    z: f.z - Math.sin(ry) * u + Math.cos(ry) * v,
  });
  const W = venue.room.width;
  const D = venue.room.depth;
  const wallDist = (p: Vec2) => Math.min(Math.abs(p.x), Math.abs(p.x - W), Math.abs(p.z), Math.abs(p.z - D));
  const plus = longX ? toWorld(0, half) : toWorld(half, 0);
  const minus = longX ? toWorld(0, -half) : toWorld(-half, 0);
  return { longX, sign: wallDist(plus) <= wallDist(minus) ? 1 : -1 };
}

/** Builds in a frame where the fixture's long axis is local x and its back is local +z. */
function oriented(f: Fixture, venue: Venue) {
  const { longX, sign } = backSign(f, venue);
  const L = longX ? f.width : f.depth;
  const D = longX ? f.depth : f.width;
  const ry = rotationY(f.rotation) + (longX ? (sign > 0 ? 0 : Math.PI) : sign > 0 ? Math.PI / 2 : -Math.PI / 2);
  return { L, D, ry };
}

function plate(color: string): THREE.BufferGeometry {
  return paint(
    lathe(
      [
        [0, 0.001],
        [0.08, 0.001],
        [0.12, 0.008],
        [0.128, 0.013],
        [0.126, 0.016],
        [0.118, 0.014],
        [0.085, 0.008],
        [0.07, 0.004],
        [0, 0.004],
      ],
      20,
    ),
    color,
    GLAZE,
  );
}

function bottle(color: string, h: number, seed: number): THREE.BufferGeometry {
  const r = 0.032 + hash(seed) * 0.01;
  return paint(
    lathe(
      [[0, 0], [r, 0], [r, h * 0.62], ...arc(r - 0.02, h * 0.62, 0.02, 0, Math.PI / 2, 3), [0.012, h * 0.82], [0.012, h], [0, h]],
      10,
    ),
    color,
    { roughness: 0.2, metalness: 0 },
  );
}

/**
 * The kitchen's back wall, shown at eye level: subway tile, an open shelf of plates,
 * bowls and copper pots. Built in the kitchen line's frame (its back is +z).
 */
function kitchenWall(L: number, h: number, D: number, p: Palette, seed: number): THREE.BufferGeometry[] {
  const out: THREE.BufferGeometry[] = [];
  const wallZ = D / 2 + 0.19;
  const tile = softBox(L + 0.2, 1.3, 0.012, 0.004, 2);
  out.push(paint(place(tile, 0, h, wallZ), p.wallCap, { roughness: 0.35, metalness: 0 }, { pattern: PATTERN.wallTiles }));
  const shelfY = 1.5;
  out.push(paint(place(softBox(L - 0.3, 0.035, 0.3, 0.01), 0, shelfY, wallZ - 0.16), p.chairWood, SATIN));
  for (const x of [-L / 2 + 0.4, 0, L / 2 - 0.4])
    out.push(paint(place(softBox(0.03, 0.12, 0.22, 0.006), x, shelfY - 0.12, wallZ - 0.12), p.steelDark, STEEL));
  const copper = "#b9754f";
  const spots = Math.floor((L - 0.6) / 0.42);
  for (let i = 0; i < spots; i++) {
    const x = -L / 2 + 0.5 + i * 0.42;
    const kind = Math.floor(hash(seed * 11 + i) * 3);
    const y = shelfY + 0.035;
    if (kind === 0) {
      for (let k = 0; k < 6; k++) out.push(place(plate(p.plate), x, y + k * 0.016, wallZ - 0.16));
    } else if (kind === 1) {
      const r = 0.1 + hash(i) * 0.03;
      out.push(
        paint(
          place(
            lathe(
              [
                [0, 0],
                [r * 0.55, 0],
                [r, r * 0.8],
                [r - 0.006, r * 0.8],
                [r * 0.5, 0.008],
                [0, 0.008],
              ],
              18,
            ),
            x,
            y,
            wallZ - 0.16,
          ),
          p.votive,
          { roughness: 0.3, metalness: 0 },
        ),
      );
    } else {
      const r = 0.11 + hash(i * 3) * 0.03;
      const hh = 0.12 + hash(i * 5) * 0.06;
      out.push(
        paint(
          place(
            lathe(
              [
                [0, 0],
                [r, 0],
                [r, hh],
                [r - 0.006, hh],
                [r - 0.006, 0.01],
                [0, 0.01],
              ],
              18,
            ),
            x,
            y,
            wallZ - 0.16,
          ),
          copper,
          { roughness: 0.35, metalness: 0.4 },
        ),
      );
    }
  }
  return out;
}

/**
 * The wall behind the bar, shown at eye level: two lit shelves of bottles over the
 * back bar. Built in the bar's frame (its back is +z).
 */
function barWall(L: number, D: number, p: Palette): THREE.BufferGeometry[] {
  const out: THREE.BufferGeometry[] = [];
  const wallZ = D / 2;
  const tones = [p.bottle, "#b58a52", "#d7d9d2", "#7d8f6a", "#8c5a3c"];
  [1.42, 1.78].forEach((y, row) => {
    out.push(paint(place(softBox(L - 0.4, 0.025, 0.24, 0.008), 0, y, wallZ - 0.12), p.chairWood, SATIN));
    out.push(
      paint(place(softBox(L - 0.5, 0.008, 0.02, 0.004), 0, y - 0.01, wallZ - 0.22), p.downlight, {
        roughness: 0.4,
        metalness: 0,
        glow: 0.6,
      }),
    );
    const n = Math.floor((L - 0.6) / 0.1);
    for (let i = 0; i < n; i++) {
      const bh = 0.24 + hash(i * 7.3 + row) * 0.1;
      out.push(
        place(bottle(tones[(i + row * 2) % tones.length]!, bh, i + row * 31), -L / 2 + 0.35 + i * 0.1, y + 0.025, wallZ - 0.12),
      );
    }
  });
  return out;
}

/** A low clipped hedge around the open edges of garden areas, so the lawn has an edge. */
function gardenHedges(venue: Venue, c: Colors): THREE.BufferGeometry[] {
  const out: THREE.BufferGeometry[] = [];
  const W = venue.room.width;
  const D = venue.room.depth;
  const nearRoom = (x: number, z: number) => x > -0.6 && x < W + 0.6 && z > -0.6 && z < D + 0.6;
  venue.areas.forEach((a, ai) => {
    if (a.kind !== "garden") return;
    const tops = areaTops(venue);
    const y = tops.get(a.id) ?? 0;
    let cx = 0;
    let cz = 0;
    for (const [x, z] of a.polygon) {
      cx += x;
      cz += z;
    }
    cx /= a.polygon.length;
    cz /= a.polygon.length;
    a.polygon.forEach(([x0, z0], i) => {
      const [x1, z1] = a.polygon[(i + 1) % a.polygon.length]!;
      const mx = (x0 + x1) / 2;
      const mz = (z0 + z1) / 2;
      if (nearRoom(mx, mz)) return;
      const len = Math.hypot(x1 - x0, z1 - z0);
      if (len < 1) return;
      const dx = (x1 - x0) / len;
      const dz = (z1 - z0) / len;
      // Inset toward the area's middle.
      let nx = -dz;
      let nz = dx;
      if ((cx - mx) * nx + (cz - mz) * nz < 0) {
        nx = -nx;
        nz = -nz;
      }
      const inset = 0.45;
      const hedgeLen = len - inset * 2;
      const body = softBox(hedgeLen, 0.5, 0.5, 0.14, 4, 3);
      out.push(paint(place(body, mx + nx * inset, y, mz + nz * inset, Math.atan2(-dz, dx)), c.palette.hedge, MATTE));
      const n = Math.max(2, Math.round(hedgeLen / 0.7));
      for (let k = 0; k < n; k++) {
        const s = -hedgeLen / 2 + 0.35 + ((hedgeLen - 0.7) / Math.max(1, n - 1)) * k;
        const tone = new THREE.Color(c.palette.hedge).multiplyScalar(0.96 + hash(ai * 97 + i * 13 + k) * 0.08);
        out.push(
          paint(
            place(blob(0.38, 0.08, 0.2, ai * 7 + i * 3 + k), mx + nx * inset + dx * s, y + 0.5, mz + nz * inset + dz * s),
            tone,
            MATTE,
          ),
        );
      }
    });
  });
  return out;
}

function fixtures(
  venue: Venue,
  c: Colors,
  out: { clay: THREE.BufferGeometry[]; glass: THREE.BufferGeometry[]; sit: THREE.BufferGeometry[] },
) {
  const p = c.palette;
  const tops = areaTops(venue);
  const upholstery = new THREE.Color(p.upholsteryBase).lerp(new THREE.Color(c.accent), p.upholsteryTint * 0.85);

  venue.fixtures.forEach((f, fi) => {
    const y0 = Math.max(0, floorTopAt(venue, { x: f.x, z: f.z }, tops));
    const { L, D, ry } = oriented(f, venue);
    const parts: THREE.BufferGeometry[] = [];
    const sit: THREE.BufferGeometry[] = [];
    const h = f.height;
    const finish = (list: THREE.BufferGeometry[], target: THREE.BufferGeometry[]) => {
      for (const g of list) target.push(place(g, f.x, y0, f.z, ry));
    };

    switch (f.kind) {
      case "pass": {
        // Fluted oak front facing the counter, a steel pass shelf, plates waiting.
        parts.push(paint(softBox(L, h - 0.045, D, 0.02), p.chairWood, SATIN, { pattern: PATTERN.flutes }));
        parts.push(paint(place(softBox(L + 0.03, 0.045, D + 0.08, 0.012), 0, h - 0.045, 0), p.steel, STEEL));
        const n = Math.floor(L / 0.9);
        for (let i = 0; i < n; i++) parts.push(place(plate(p.plate), -L / 2 + (L / n) * (i + 0.5), h, -0.02));
        // Heat-lamp gantry over the pass, only at eye level.
        for (const x of [-L / 2 + 0.2, 0, L / 2 - 0.2])
          sit.push(paint(place(post(0.02, 0.02, h, 1.78, 8), x, 0, 0), p.steelDark, STEEL));
        sit.push(paint(place(softBox(L - 0.2, 0.07, 0.16, 0.02), 0, 1.78, 0), p.steelDark, STEEL));
        // Heat lamps hanging under the gantry, glowing warm.
        const lamps = Math.max(3, Math.floor(L / 0.8));
        for (let i = 0; i < lamps; i++) {
          const x = -L / 2 + 0.3 + ((L - 0.6) / (lamps - 1)) * i;
          sit.push(paint(place(post(0.006, 0.006, 1.6, 1.78, 6), x, 0, 0), p.steelDark, STEEL));
          sit.push(
            paint(
              place(
                lathe(
                  [
                    [0, 0],
                    [0.07, 0],
                    [0.04, 0.09],
                    [0, 0.09],
                  ],
                  14,
                ),
                x,
                1.52,
                0,
              ),
              p.steelDark,
              STEEL,
            ),
          );
          sit.push(
            paint(
              place(
                lathe(
                  [
                    [0, 0],
                    [0.05, 0],
                    [0, 0.004],
                  ],
                  14,
                ),
                x,
                1.515,
                0,
              ),
              p.downlight,
              { roughness: 0.4, metalness: 0, glow: 1 },
            ),
          );
        }
        break;
      }
      case "kitchen-line": {
        parts.push(paint(place(softBox(L - 0.06, 0.1, D - 0.1, 0.01), 0, 0, 0.02), p.steelDark, STEEL));
        parts.push(paint(place(softBox(L, h - 0.14, D, 0.012), 0, 0.1, 0), p.steel, STEEL));
        parts.push(paint(place(softBox(L + 0.02, 0.04, D + 0.02, 0.008), 0, h - 0.04, 0), p.steel, STEEL));
        parts.push(paint(place(softBox(L + 0.02, 0.34, 0.03, 0.01), 0, h, D / 2 - 0.015), p.steel, STEEL));
        const cooktops = Math.max(2, Math.floor(L / 1.6));
        for (let i = 0; i < cooktops; i++) {
          const x = -L / 2 + (L / cooktops) * (i + 0.5);
          parts.push(
            paint(place(softBox(0.78, 0.012, 0.52, 0.03), x, h, -0.04), p.steelDark, { roughness: 0.5, metalness: 0.2 }),
          );
          const potR = 0.11 + hash(fi * 13 + i) * 0.05;
          const potH = 0.1 + hash(fi * 7 + i) * 0.08;
          parts.push(
            paint(
              place(
                lathe(
                  [
                    [0, 0],
                    [potR, 0],
                    [potR, potH],
                    [potR - 0.008, potH],
                    [potR - 0.008, 0.01],
                    [0, 0.01],
                  ],
                  18,
                ),
                x - 0.18 + hash(i) * 0.36,
                h + 0.012,
                -0.05,
              ),
              p.steel,
              STEEL,
            ),
          );
        }
        sit.push(paint(place(softBox(L, 0.46, 0.8, 0.03), 0, 1.95, D / 2 - 0.4 + 0.18), p.steel, STEEL));
        sit.push(...kitchenWall(L, h, D, p, fi));
        break;
      }
      case "host-stand": {
        parts.push(paint(softBox(L, h - 0.04, D, 0.05), p.chairWood, SATIN));
        const top = new THREE.Color(c.accent).lerp(new THREE.Color(p.wall), 0.35);
        parts.push(paint(place(softBox(L + 0.03, 0.04, D + 0.03, 0.014), 0, h - 0.04, 0), top, SATIN));
        break;
      }
      case "back-of-house": {
        const body = slab(roundedRectShape(L, D, 0.05), h - 0.07, 0, 6);
        parts.push(paint(body, p.wall, MATTE, { rise: stretch(0, h - 0.07) }));
        const cap = slab(roundedRectShape(L, D, 0.05), 0.07, 0.035, 6);
        cap.translate(0, h - 0.07, 0);
        parts.push(paint(cap, p.wallCap, MATTE, { rise: LIFT }));
        break;
      }
      case "service-station": {
        parts.push(paint(softBox(L, h - 0.03, D, 0.02), p.chairWood, SATIN));
        parts.push(paint(place(softBox(L + 0.02, 0.03, D + 0.02, 0.01), 0, h - 0.03, 0), p.stone, SATIN));
        for (let s = 0; s < 3; s++) {
          for (let k = 0; k < 6; k++) parts.push(place(plate(p.plate), -L / 2 + 0.3 + s * ((L - 0.6) / 2), h + k * 0.016, -0.05));
        }
        break;
      }
      case "railing": {
        const bays = Math.max(1, Math.ceil(L / 1.6));
        const bay = L / bays;
        for (let i = 0; i <= bays; i++)
          parts.push(paint(place(post(0.018, 0.018, 0, h - 0.04, 10), -L / 2 + bay * i, 0, 0), p.frame, METAL));
        parts.push(paint(place(softBox(L + 0.04, 0.045, 0.06, 0.02), 0, h - 0.045, 0), p.chairWood, SATIN));
        for (let i = 0; i < bays; i++) {
          const pane = new THREE.PlaneGeometry(bay - 0.06, h - 0.16);
          pane.translate(-L / 2 + bay * (i + 0.5), 0.06 + (h - 0.16) / 2, 0);
          out.glass.push(glassPart(place(pane, f.x, y0, f.z, ry), STILL));
        }
        break;
      }
      case "planter": {
        // A planter with a slightly proud rim and a shadow gap at its foot.
        parts.push(paint(place(softBox(L - 0.06, 0.05, D - 0.06, 0.02), 0, 0, 0), p.steelDark, MATTE));
        parts.push(paint(place(softBox(L, h - 0.09, D, 0.03), 0, 0.04, 0), p.planter, MATTE));
        parts.push(paint(place(softBox(L + 0.03, 0.05, D + 0.03, 0.02), 0, h - 0.05, 0), p.stone, SATIN));
        parts.push(paint(place(softBox(L - 0.1, 0.02, D - 0.1, 0.01), 0, h - 0.035, 0), p.soil, MATTE));
        if (L / D > 1.6) {
          // A clipped hedge: one soft, squared-off mass with a gently uneven top.
          parts.push(paint(place(softBox(L - 0.1, 0.42, D - 0.12, 0.13, 4, 3), 0, h - 0.04, 0), p.hedge, MATTE));
          const n = Math.max(2, Math.round(L / 0.5));
          for (let i = 0; i < n; i++) {
            const tone = new THREE.Color(p.hedge).multiplyScalar(0.97 + hash(fi * 31 + i) * 0.06);
            const x = -L / 2 + 0.3 + ((L - 0.6) / Math.max(1, n - 1)) * i;
            parts.push(paint(place(blob(0.3, 0.09, D * 0.36, fi * 3 + i), x, h + 0.3, 0), tone, MATTE));
          }
        } else {
          parts.push(paint(post(0.05, 0.032, h - 0.04, h + 1.3, 10), p.trunk, MATTE));
          // One full, gently uneven crown with a few softer lobes underneath.
          parts.push(paint(place(blob(0.62, 0.52, 0.6, fi * 5, 3, 0.11, 1.4), 0, h + 1.42, 0), p.canopy, MATTE));
          const lobes: [number, number, number, number][] = [
            [0.34, 1.22, 0.1, 0.34],
            [-0.3, 1.25, -0.16, 0.33],
            [0.02, 1.2, 0.34, 0.3],
          ];
          lobes.forEach(([x, y, z, r], i) => {
            const tone = new THREE.Color(p.canopy).multiplyScalar(0.94 + hash(fi * 17 + i) * 0.06);
            parts.push(paint(place(blob(r, r * 0.8, r, fi * 5 + i + 1, 2, 0.1, 1.6), x, h + y, z), tone, MATTE));
          });
        }
        break;
      }
      case "column": {
        const r = Math.min(L, D) / 2;
        const body = new THREE.CylinderGeometry(r, r, h - r, 24, 1, true);
        body.translate(0, (h - r) / 2, 0);
        parts.push(paint(body, p.wall, MATTE, { rise: stretch(0, h - r) }));
        const dome = new THREE.SphereGeometry(r, 24, 8, 0, Math.PI * 2, 0, Math.PI / 2);
        dome.translate(0, h - r, 0);
        parts.push(paint(dome, p.wallCap, MATTE, { rise: LIFT }));
        break;
      }
      case "bar": {
        const counterH = Math.min(0.92, h - 0.12);
        parts.push(paint(place(softBox(L - 0.04, 0.1, D - 0.06, 0.01), 0, 0, 0.02), p.metal, SATIN));
        parts.push(paint(place(softBox(L, counterH - 0.14, D, 0.02), 0, 0.1, 0), p.chairWood, SATIN));
        parts.push(paint(place(softBox(L + 0.02, 0.04, D + 0.02, 0.01), 0, counterH - 0.04, 0), p.stone, SATIN));
        const shelfD = D * 0.42;
        parts.push(paint(place(softBox(L, h - counterH, shelfD, 0.012), 0, counterH, D / 2 - shelfD / 2), p.chairWood, SATIN));
        const tones = [p.bottle, "#b58a52", "#d7d9d2", "#7d8f6a"];
        const n = Math.floor((L - 0.2) / 0.11);
        for (let i = 0; i < n; i++) {
          const bh = 0.24 + hash(i * 3.1) * 0.1;
          parts.push(place(bottle(tones[i % tones.length]!, bh, i), -L / 2 + 0.1 + i * 0.11 + 0.055, h, D / 2 - shelfD / 2));
        }
        sit.push(...barWall(L, D, p));
        for (let i = 0; i < 5; i++) {
          parts.push(
            paint(
              place(
                lathe(
                  [
                    [0, 0],
                    [0.034, 0],
                    [0.038, 0.11],
                    [0.035, 0.11],
                    [0.031, 0.006],
                    [0, 0.006],
                  ],
                  12,
                ),
                -L / 2 + 0.6 + i * 0.22,
                counterH,
                -D / 2 + 0.12,
              ),
              p.votive,
              { roughness: 0.2, metalness: 0 },
            ),
          );
        }
        break;
      }
      case "banquette": {
        const seatTop = 0.46;
        parts.push(paint(place(softBox(L, seatTop - 0.1, D - 0.1, 0.012), 0, 0, 0.03), p.metal, SATIN));
        parts.push(paint(place(softBox(L, 0.1, D - 0.1, 0.04), 0, seatTop - 0.1, -0.02), upholstery, UPHOLSTERY));
        const segs = Math.max(1, Math.round(L / 0.62));
        const sl = L / segs;
        for (let i = 0; i < segs; i++) {
          const back = softBox(sl - 0.014, h - seatTop + 0.02, 0.16, 0.06, 6);
          back.applyMatrix4(new THREE.Matrix4().makeRotationX(0.1));
          parts.push(paint(place(back, -L / 2 + sl * (i + 0.5), seatTop - 0.02, D / 2 - 0.13), upholstery, UPHOLSTERY));
        }
        parts.push(paint(place(softBox(L, h + 0.02, 0.05, 0.02), 0, 0, D / 2 - 0.025), p.chairWood, SATIN));
        break;
      }
      case "counter": {
        parts.push(paint(softBox(L, h - 0.04, D, 0.02), p.chairWood, SATIN));
        parts.push(paint(place(softBox(L + 0.03, 0.04, D + 0.03, 0.01), 0, h - 0.04, 0), p.stone, SATIN));
        break;
      }
    }
    finish(parts, out.clay);
    finish(sit, out.sit);
  });
}

/* ----------------------------------------------------------------- Ceiling */

function ceiling(venue: Venue, c: Colors, sit: THREE.BufferGeometry[]) {
  const { width: W, depth: D, ceilingHeight: C } = venue.room;
  const p = c.palette;
  const slabGeo = softBox(W + T * 2, 0.14, D + T * 2, 0.02, 2);
  slabGeo.translate(W / 2, C, D / 2);
  sit.push(paint(slabGeo, p.ceiling, MATTE));
  const nx = Math.max(2, Math.round(W / 2.6));
  const nz = Math.max(2, Math.round(D / 2.6));
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < nz; j++) {
      const x = (W / nx) * (i + 0.5);
      const z = (D / nz) * (j + 0.5);
      const trim = lathe(
        [
          [0, 0],
          [0.105, 0],
          [0.105, 0.006],
          [0, 0.006],
        ],
        20,
      );
      trim.rotateX(Math.PI);
      trim.translate(x, C - 0.001, z);
      sit.push(paint(trim, p.steelDark, SATIN));
      const lens = lathe(
        [
          [0, 0],
          [0.075, 0],
          [0.075, 0.004],
          [0, 0.004],
        ],
        20,
      );
      lens.rotateX(Math.PI);
      lens.translate(x, C - 0.007, z);
      sit.push(paint(lens, p.downlight, { roughness: 0.4, metalness: 0, glow: 1 }));
    }
  }
}

/* ------------------------------------------------------------ Surroundings */

/**
 * Breaks a long span into pieces: short near the site, long far away. Huge sliver
 * triangles that cross the near plane can rasterize with wrong depth on some GPUs, so
 * nothing the camera can get close to is ever one giant triangle.
 */
export function spans(from: number, to: number, nearFrom: number, nearTo: number, step: number): [number, number][] {
  const cuts = new Set<number>([from, to]);
  const a = Math.max(from, nearFrom);
  const b = Math.min(to, nearTo);
  if (a < b) for (let x = a; x <= b + 1e-6; x += step) cuts.add(Math.min(x, b));
  const sorted = [...cuts].filter((x) => x >= from && x <= to).sort((p, q) => p - q);
  const out: [number, number][] = [];
  for (let i = 0; i + 1 < sorted.length; i++) if (sorted[i + 1]! - sorted[i]! > 1e-6) out.push([sorted[i]!, sorted[i + 1]!]);
  return out;
}

/** A floor-level rectangle as a grid of cells, fine near the site and coarse beyond. */
function groundPatch(
  minX: number,
  maxX: number,
  minZ: number,
  maxZ: number,
  fine: { minX: number; maxX: number; minZ: number; maxZ: number },
  y: number,
): THREE.BufferGeometry[] {
  const out: THREE.BufferGeometry[] = [];
  for (const [x0, x1] of spans(minX, maxX, fine.minX, fine.maxX, 6)) {
    for (const [z0, z1] of spans(minZ, maxZ, fine.minZ, fine.maxZ, 6)) {
      const p = new THREE.PlaneGeometry(x1 - x0, z1 - z0);
      p.rotateX(-Math.PI / 2);
      p.translate((x0 + x1) / 2, y, (z0 + z1) / 2);
      out.push(p);
    }
  }
  return out;
}

function surroundings(
  venue: Venue,
  c: Colors,
): Pick<ShellGeometry, "ground" | "water" | "shore" | "fadeCenter" | "siteRadius" | "siteRect"> {
  const b = siteBounds(venue);
  const center = boundsCenter(b);
  const siteRadius = Math.hypot(b.maxX - b.minX, b.maxZ - b.minZ) / 2;
  const R = 700;
  const NEAR = 60;
  const fine = { minX: b.minX - NEAR, maxX: b.maxX + NEAR, minZ: b.minZ - NEAR, maxZ: b.maxZ + NEAR };
  let minX = center.x - R;
  let maxX = center.x + R;
  let minZ = center.z - R;
  let maxZ = center.z + R;
  const water = venue.surroundings.water;
  let shore: ShellGeometry["shore"] = null;
  if (water) {
    if (water.side === "north") {
      minZ = water.at;
      shore = { x: center.x, z: water.at, dx: 0, dz: -1 };
    } else if (water.side === "south") {
      maxZ = water.at;
      shore = { x: center.x, z: water.at, dx: 0, dz: 1 };
    } else if (water.side === "west") {
      minX = water.at;
      shore = { x: water.at, z: center.z, dx: -1, dz: 0 };
    } else {
      maxX = water.at;
      shore = { x: water.at, z: center.z, dx: 1, dz: 0 };
    }
  }
  const groundColor = c.palette.ground[venue.surroundings.ground];
  const pattern = venue.surroundings.ground === "lawn" ? PATTERN.lawn : PATTERN.none;
  const parts: THREE.BufferGeometry[] = groundPatch(minX, maxX, minZ, maxZ, fine, GROUND_Y).map((g) =>
    paint(g, groundColor, MATTE, { pattern }),
  );

  let waterGeo: THREE.BufferGeometry | null = null;
  if (water && shore) {
    // Quay wall and coping along the water line, in pieces.
    const alongX = shore.dx === 0;
    const ry = alongX ? (shore.dz < 0 ? Math.PI : 0) : shore.dx > 0 ? Math.PI / 2 : -Math.PI / 2;
    const lineMin = alongX ? center.x - R : center.z - R;
    const lineMax = alongX ? center.x + R : center.z + R;
    const nearMin = alongX ? fine.minX : fine.minZ;
    const nearMax = alongX ? fine.maxX : fine.maxZ;
    for (const [a, z] of spans(lineMin, lineMax, nearMin, nearMax, 8)) {
      const len = z - a;
      const mid = (a + z) / 2;
      const face = new THREE.PlaneGeometry(len, GROUND_Y - WATER_Y);
      face.translate(0, (GROUND_Y + WATER_Y) / 2, 0);
      place(face, alongX ? mid : shore.x, 0, alongX ? shore.z : mid, ry);
      parts.push(paint(face, c.palette.quay, MATTE));
      const coping = softBox(len, 0.06, 0.32, 0.02, 2);
      coping.translate(0, GROUND_Y, 0.16 - 0.04);
      place(coping, alongX ? mid : shore.x, 0, alongX ? shore.z : mid, ry + Math.PI);
      parts.push(paint(coping, c.palette.stone, MATTE));
    }
    const sea = 5000;
    const wMinX = alongX ? center.x - sea : shore.dx > 0 ? shore.x : shore.x - sea;
    const wMaxX = alongX ? center.x + sea : shore.dx > 0 ? shore.x + sea : shore.x;
    const wMinZ = alongX ? (shore.dz > 0 ? shore.z : shore.z - sea) : center.z - sea;
    const wMaxZ = alongX ? (shore.dz > 0 ? shore.z + sea : shore.z) : center.z + sea;
    const tiles = groundPatch(wMinX, wMaxX, wMinZ, wMaxZ, fine, WATER_Y);
    for (const t of tiles) for (const name of Object.keys(t.attributes)) if (name !== "position") t.deleteAttribute(name);
    waterGeo = mergeGeometries(
      tiles.map((t) => (t.index ? t.toNonIndexed() : t)),
      false,
    );
  }
  return {
    ground: merge(parts),
    water: waterGeo,
    shore,
    fadeCenter: center,
    siteRadius,
    siteRect: [b.minX, b.minZ, b.maxX, b.maxZ],
  };
}

/* ------------------------------------------------------------------- Shell */

export function buildShell(venue: Venue, palette: Palette, accent: string): ShellGeometry {
  const c: Colors = { palette, accent };
  const out = { clay: [] as THREE.BufferGeometry[], glass: [] as THREE.BufferGeometry[], sit: [] as THREE.BufferGeometry[] };
  out.clay.push(...floors(venue, c));
  walls(venue, c, out);
  fixtures(venue, c, out);
  out.clay.push(...gardenHedges(venue, c));
  ceiling(venue, c, out.sit);
  const s = surroundings(venue, c);
  const glass = out.glass.length ? mergeGlass(out.glass) : empty();
  return {
    clay: merge(out.clay),
    glass,
    sitOnly: merge(out.sit),
    ...s,
    interiorRect: [0, 0, venue.room.width, venue.room.depth],
  };
}

function mergeGlass(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const total = parts.reduce((n, g) => n + g.attributes.position!.count, 0);
  const pos = new Float32Array(total * 3);
  const nor = new Float32Array(total * 3);
  const rise = new Float32Array(total);
  let o = 0;
  for (const g of parts) {
    const n = g.attributes.position!.count;
    pos.set(g.attributes.position!.array, o * 3);
    nor.set(g.attributes.normal!.array, o * 3);
    rise.set(g.attributes.rise!.array, o);
    o += n;
    g.dispose();
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
  g.setAttribute("rise", new THREE.BufferAttribute(rise, 1));
  g.computeBoundingSphere();
  return g;
}
