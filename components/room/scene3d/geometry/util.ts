import * as THREE from "three";
import { mergeGeometries, mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";

/**
 * Small geometry kit. Every part is painted per vertex with a color, a surface
 * (roughness, metalness, glow), a floor pattern id and a rise weight, then merged, so
 * a whole object draws in one call and the walls can rise in the vertex shader.
 */

export interface Surface {
  roughness: number;
  metalness: number;
  /** Emissive strength, scaled by the palette (votives at dusk). */
  glow?: number;
}

export const MATTE: Surface = { roughness: 0.9, metalness: 0 };
export const SATIN: Surface = { roughness: 0.62, metalness: 0 };
export const UPHOLSTERY: Surface = { roughness: 0.97, metalness: 0 };
export const METAL: Surface = { roughness: 0.45, metalness: 0.3 };
export const STEEL: Surface = { roughness: 0.36, metalness: 0.35 };
export const GLAZE: Surface = { roughness: 0.3, metalness: 0 };

/** Procedural surface patterns drawn by the clay shader in world space. */
export const PATTERN = { none: 0, planks: 1, tiles: 2, pavers: 3, lawn: 4, boards: 5 } as const;

export type Rise =
  /** Never moves. */
  | { kind: "none" }
  /** Moves up by the full rise (wall caps, head rails). */
  | { kind: "lift" }
  /** Stretches: vertices at `base` stay, vertices at `top` move by the full rise. */
  | { kind: "stretch"; base: number; top: number };

export const STILL: Rise = { kind: "none" };
export const LIFT: Rise = { kind: "lift" };
export const stretch = (base: number, top: number): Rise => ({ kind: "stretch", base, top });

export interface PaintOptions {
  rise?: Rise;
  pattern?: number;
}

const tmp = new THREE.Color();

/** Adds the shared vertex attributes and drops everything but position and normal. */
export function paint(
  geo: THREE.BufferGeometry,
  color: string | THREE.Color,
  surface: Surface = MATTE,
  opts: PaintOptions = {},
): THREE.BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo;
  if (g !== geo) geo.dispose();
  for (const name of Object.keys(g.attributes)) {
    if (name !== "position" && name !== "normal") g.deleteAttribute(name);
  }
  g.clearGroups();
  if (!g.attributes.normal) g.computeVertexNormals();
  const pos = g.attributes.position!;
  const n = pos.count;
  tmp.set(color);
  const colors = new Float32Array(n * 3);
  const pbr = new Float32Array(n * 3);
  const rise = new Float32Array(n);
  const pattern = new Float32Array(n);
  const r = opts.rise ?? STILL;
  for (let i = 0; i < n; i++) {
    colors[i * 3] = tmp.r;
    colors[i * 3 + 1] = tmp.g;
    colors[i * 3 + 2] = tmp.b;
    pbr[i * 3] = surface.roughness;
    pbr[i * 3 + 1] = surface.metalness;
    pbr[i * 3 + 2] = surface.glow ?? 0;
    pattern[i] = opts.pattern ?? 0;
    if (r.kind === "lift") rise[i] = 1;
    else if (r.kind === "stretch") rise[i] = Math.min(1, Math.max(0, (pos.getY(i) - r.base) / (r.top - r.base)));
  }
  g.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  g.setAttribute("pbr", new THREE.BufferAttribute(pbr, 3));
  g.setAttribute("rise", new THREE.BufferAttribute(rise, 1));
  g.setAttribute("pattern", new THREE.BufferAttribute(pattern, 1));
  return g;
}

export function merge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const live = parts.filter((p) => p.attributes.position && p.attributes.position.count > 0);
  if (!live.length) return empty();
  const merged = mergeGeometries(live, false);
  for (const p of live) p.dispose();
  if (!merged) throw new Error("could not merge geometry parts");
  merged.computeBoundingBox();
  merged.computeBoundingSphere();
  return merged;
}

export function empty(): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  for (const [name, size] of [
    ["position", 3],
    ["normal", 3],
    ["color", 3],
    ["pbr", 3],
    ["rise", 1],
    ["pattern", 1],
  ] as const) {
    g.setAttribute(name, new THREE.BufferAttribute(new Float32Array(0), size));
  }
  return g;
}

/** Moves and turns a part: rotations in radians (Y, then X, then Z), applied before the translation. */
export function place(geo: THREE.BufferGeometry, x: number, y: number, z: number, ry = 0, rx = 0, rz = 0): THREE.BufferGeometry {
  const m = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rx, ry, rz, "YXZ"));
  m.setPosition(x, y, z);
  geo.applyMatrix4(m);
  return geo;
}

/** A rounded rectangle centered on the origin, in the shape's XY plane. */
export function roundedRectShape(w: number, d: number, r: number): THREE.Shape {
  const s = new THREE.Shape();
  const x = -w / 2;
  const y = -d / 2;
  const rr = Math.max(1e-4, Math.min(r, w / 2 - 1e-4, d / 2 - 1e-4));
  s.moveTo(x + rr, y);
  s.lineTo(x + w - rr, y);
  s.absarc(x + w - rr, y + rr, rr, -Math.PI / 2, 0, false);
  s.lineTo(x + w, y + d - rr);
  s.absarc(x + w - rr, y + d - rr, rr, 0, Math.PI / 2, false);
  s.lineTo(x + rr, y + d);
  s.absarc(x + rr, y + d - rr, rr, Math.PI / 2, Math.PI, false);
  s.lineTo(x, y + rr);
  s.absarc(x + rr, y + rr, rr, Math.PI, Math.PI * 1.5, false);
  return s;
}

/**
 * Extrudes a plan shape upward into a slab from y=0 to y=height with a soft bevel
 * that stays inside the outline. Shape coordinates are (x, -z).
 */
export function slab(
  shape: THREE.Shape,
  height: number,
  bevel = 0.008,
  curveSegments = 4,
  bevelSegments = 2,
): THREE.BufferGeometry {
  const b = Math.max(0, Math.min(bevel, height / 2.2));
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: Math.max(1e-4, height - 2 * b),
    bevelEnabled: b > 0,
    bevelThickness: b,
    bevelSize: b,
    bevelOffset: -b,
    bevelSegments,
    curveSegments,
  });
  geo.rotateX(-Math.PI / 2);
  geo.translate(0, b, 0);
  return geo;
}

/** A shape from plan points [x, z]. */
export function planShape(points: [number, number][]): THREE.Shape {
  const s = new THREE.Shape();
  points.forEach(([x, z], i) => (i === 0 ? s.moveTo(x, -z) : s.lineTo(x, -z)));
  s.closePath();
  return s;
}

/** A box with softly rounded vertical edges and a bevelled top, sitting on y=0. */
export function softBox(w: number, h: number, d: number, r: number, curveSegments = 3, bevelSegments = 2): THREE.BufferGeometry {
  return slab(roundedRectShape(w, d, r), h, Math.min(r, h / 2.2), curveSegments, bevelSegments);
}

/** A plain box sitting on y=0 (for wall bodies, where the cap provides the softness). */
export function block(w: number, h: number, d: number): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(0, h / 2, 0);
  return g;
}

/** A tapered round post from y0 to y1. */
export function post(r0: number, r1: number, y0: number, y1: number, segments = 10): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(r1, r0, y1 - y0, segments, 1, false);
  g.translate(0, (y0 + y1) / 2, 0);
  return g;
}

/** A lathe from a profile of [radius, y] points, counterclockwise so normals face out. */
export function lathe(profile: [number, number][], segments = 32, phiStart = 0, phiLength = Math.PI * 2): THREE.BufferGeometry {
  return new THREE.LatheGeometry(
    profile.map(([r, y]) => new THREE.Vector2(Math.max(0, r), y)),
    segments,
    phiStart,
    phiLength,
  );
}

/** Points along an arc, for rounded profiles. */
export function arc(cx: number, cy: number, r: number, a0: number, a1: number, steps = 5): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i <= steps; i++) {
    const a = a0 + ((a1 - a0) * i) / steps;
    out.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
  }
  return out;
}

/** Deterministic noise in [0, 1) (no Math.random: renders must repeat exactly). */
export function hash(n: number): number {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453123;
  return s - Math.floor(s);
}

/** An organic blob (hedges, canopies): a squashed, gently lumpy sphere sitting at its center. */
export function blob(rx: number, ry: number, rz: number, seed: number, detail = 2): THREE.BufferGeometry {
  const ico = new THREE.IcosahedronGeometry(1, detail);
  ico.deleteAttribute("normal");
  ico.deleteAttribute("uv");
  const g = mergeVertices(ico);
  ico.dispose();
  const p = g.attributes.position!;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const y = p.getY(i);
    const z = p.getZ(i);
    const n = 1 + Math.sin(x * 5.1 + seed) * Math.sin(y * 4.3 + seed * 1.7) * Math.sin(z * 4.7 + seed * 0.3) * 0.06;
    p.setXYZ(i, x * rx * n, y * ry * n, z * rz * n);
  }
  g.computeVertexNormals();
  return g;
}
