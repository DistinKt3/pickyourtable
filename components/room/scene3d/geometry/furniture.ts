import * as THREE from "three";
import { BOOTH_OUTER, BOOTH_SEAT_INNER, CHAIR_GAP, SEAT_HEIGHT, TABLE_HEIGHT, bearing } from "@/lib/venue/geometry";
import type { VenueTable } from "@/lib/venue/schema";
import { type TablePlacement, worldToLocal } from "../layout";
import {
  arc,
  block,
  GLAZE,
  lathe,
  MATTE,
  merge,
  METAL,
  paint,
  place,
  post,
  roundedRectShape,
  SATIN,
  slab,
  softBox,
  type Surface,
  UPHOLSTERY,
} from "./util";

/**
 * Furniture at real proportions: two-tops 70 x 70 cm at 75 cm, chairs with a 45 cm
 * seat and a gently curved back, pedestal and leg bases, C-shaped booths with a tall
 * upholstered back, and the counter as continuous segments. Each table and its seats
 * merge into one geometry in the table group's local frame (forward is -z).
 */

export interface FurnitureColors {
  top: string;
  base: string;
  wood: string;
  upholstery: string;
  plate: string;
  glassware: string;
  votive: string;
  outdoor: boolean;
}

const TOP_THICKNESS = 0.036;

/* ------------------------------------------------------------------- Chair */

/** A dining chair with its seat center at the origin; the sitter faces -z. */
export function chairGeometry(c: Pick<FurnitureColors, "wood" | "upholstery" | "outdoor">): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const frame = c.outdoor ? METAL : SATIN;
  const seatW = 0.44;
  const seatD = 0.42;
  const cushion = 0.055;
  // Seat cushion: top exactly at the 45 cm seat height.
  parts.push(paint(place(softBox(seatW, cushion, seatD, 0.024, 2), 0, SEAT_HEIGHT - cushion, 0), c.upholstery, UPHOLSTERY));
  // Seat rail under the cushion.
  parts.push(paint(place(block(seatW - 0.05, 0.03, seatD - 0.05), 0, SEAT_HEIGHT - cushion - 0.03, 0), c.wood, frame));
  const legR = c.outdoor ? 0.012 : 0.017;
  const lx = seatW / 2 - 0.045;
  const lz = seatD / 2 - 0.045;
  const legTop = SEAT_HEIGHT - cushion - 0.02;
  // Front legs.
  parts.push(paint(place(post(legR * 0.75, legR, 0, legTop, 6), -lx, 0, -lz), c.wood, frame));
  parts.push(paint(place(post(legR * 0.75, legR, 0, legTop, 6), lx, 0, -lz), c.wood, frame));
  // Rear legs run on up into the back posts, raked back slightly.
  const rake = 0.07;
  for (const sx of [-lx, lx]) {
    const g = post(legR * 0.8, legR, 0, 0.8, 6);
    g.applyMatrix4(new THREE.Matrix4().makeRotationX(rake));
    parts.push(paint(place(g, sx, 0, lz), c.wood, frame));
  }
  // Curved backrest between the posts, concave toward the sitter.
  const backR = 0.55;
  const half = Math.asin((seatW / 2 + 0.005) / backR);
  const thick = 0.026;
  const shape = new THREE.Shape();
  const cz = -backR;
  const pts: [number, number][] = [];
  const steps = 7;
  for (let i = 0; i <= steps; i++) {
    const a = -half + (2 * half * i) / steps;
    pts.push([Math.sin(a) * backR, cz + Math.cos(a) * backR]);
  }
  for (let i = steps; i >= 0; i--) {
    const a = -half + (2 * half * i) / steps;
    pts.push([Math.sin(a) * (backR + thick), cz + Math.cos(a) * (backR + thick)]);
  }
  pts.forEach(([x, z], i) => (i === 0 ? shape.moveTo(x, -z) : shape.lineTo(x, -z)));
  shape.closePath();
  const backH = 0.27;
  const back = slab(shape, backH, 0.009, 4, 1);
  back.applyMatrix4(new THREE.Matrix4().makeRotationX(rake));
  parts.push(paint(place(back, 0, 0.53, lz + 0.035 - 0.018), c.outdoor ? c.wood : c.upholstery, c.outdoor ? frame : UPHOLSTERY));
  return merge(parts);
}

/* ------------------------------------------------------------ Table bases */

function pedestal(footR: number, color: string, surface: Surface): THREE.BufferGeometry {
  const top = TABLE_HEIGHT - TOP_THICKNESS;
  const profile: [number, number][] = [
    [0, 0],
    [footR - 0.012, 0],
    ...arc(footR - 0.012, 0.012, 0.012, -Math.PI / 2, 0, 3),
    [footR, 0.014],
    ...arc(footR - 0.03, 0.016, 0.03, 0.1, Math.PI / 2, 4),
    [0.05, 0.05],
    [0.034, 0.09],
    [0.032, top - 0.06],
    [0.04, top - 0.03],
    [0.11, top - 0.012],
    [0.11, top],
    [0, top],
  ];
  return paint(lathe(profile, 18), color, surface);
}

function legs(w: number, d: number, inset: number, color: string, surface: Surface, square: boolean): THREE.BufferGeometry[] {
  const out: THREE.BufferGeometry[] = [];
  const top = TABLE_HEIGHT - TOP_THICKNESS;
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const x = sx * (w / 2 - inset);
      const z = sz * (d / 2 - inset);
      const g = square ? softBox(0.042, top, 0.042, 0.008, 1) : post(0.013, 0.016, 0, top, 10);
      if (square) g.translate(0, 0, 0);
      out.push(paint(place(g, x, 0, z), color, surface));
    }
  }
  // Apron under the top keeps four legs from looking stuck on.
  const apron = softBox(w - inset * 2 + 0.02, 0.07, d - inset * 2 + 0.02, 0.012, 1);
  out.push(paint(place(apron, 0, top - 0.07, 0), color, surface));
  return out;
}

/* ---------------------------------------------------------- Place settings */

function plateGeometry(color: string): THREE.BufferGeometry {
  const profile: [number, number][] = [
    [0, 0.004],
    [0.07, 0.004],
    [0.085, 0.008],
    [0.118, 0.014],
    [0.126, 0.016],
    [0.128, 0.013],
    [0.12, 0.008],
    [0.08, 0.001],
    [0, 0.001],
  ];
  return paint(lathe(profile.reverse(), 14), color, GLAZE);
}

function wineGlassGeometry(color: string): THREE.BufferGeometry {
  const profile: [number, number][] = [
    [0, 0.0],
    [0.032, 0.0],
    [0.033, 0.004],
    [0.006, 0.008],
    [0.0045, 0.075],
    [0.016, 0.088],
    [0.036, 0.12],
    [0.038, 0.15],
    [0.033, 0.175],
    [0.031, 0.176],
    [0.029, 0.152],
    [0.0, 0.11],
  ];
  return paint(lathe(profile, 8), color, { roughness: 0.18, metalness: 0 });
}

function votiveGeometry(color: string): THREE.BufferGeometry {
  const body: [number, number][] = [
    [0, 0],
    [0.028, 0],
    ...arc(0.024, 0.004, 0.004, -Math.PI / 2, 0, 2),
    [0.03, 0.05],
    [0.026, 0.056],
    [0.024, 0.052],
    [0, 0.05],
  ];
  return paint(lathe(body, 10), color, { roughness: 0.25, metalness: 0, glow: 1 });
}

interface SettingSpot {
  x: number;
  z: number;
  /** Local rotation.y for the setting (the guest's facing). */
  ry: number;
}

function settings(spots: SettingSpot[], c: FurnitureColors): THREE.BufferGeometry[] {
  const out: THREE.BufferGeometry[] = [];
  for (const s of spots) {
    out.push(place(plateGeometry(c.plate), s.x, TABLE_HEIGHT, s.z, s.ry));
    // The glass sits to the guest's right, just beyond the plate.
    const gx = s.x + Math.cos(s.ry) * 0.14 + Math.sin(s.ry) * -0.11;
    const gz = s.z - Math.sin(s.ry) * 0.14 + Math.cos(s.ry) * -0.11;
    out.push(place(wineGlassGeometry(c.glassware), gx, TABLE_HEIGHT, gz));
  }
  return out;
}

/* ------------------------------------------------------------------ Booths */

/** The C-shaped booth bench around a round table, opening toward local -z. */
export function boothBenchGeometry(tableRadius: number, c: FurnitureColors, arcDegrees: number): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const r0 = tableRadius + BOOTH_SEAT_INNER;
  const ro = tableRadius + BOOTH_OUTER;
  const phiLength = (arcDegrees * Math.PI) / 180;
  const phiStart = -phiLength / 2;
  const segs = 28;
  const ring = (profile: [number, number][], color: string, surface: Surface) => {
    parts.push(paint(lathe(profile, segs, phiStart, phiLength), color, surface));
    // Close both ends of the arc with the profile itself.
    for (const end of [0, 1]) {
      const shape = new THREE.Shape();
      profile.forEach(([r, y], i) => (i === 0 ? shape.moveTo(r, y) : shape.lineTo(r, y)));
      shape.closePath();
      const cap = new THREE.ShapeGeometry(shape, 2);
      const phi = end === 0 ? phiStart : phiStart + phiLength;
      if (end === 1) flipFaces(cap);
      cap.applyMatrix4(new THREE.Matrix4().makeRotationY(phi - Math.PI / 2));
      parts.push(paint(cap, color, surface));
    }
  };
  const seatTop = SEAT_HEIGHT;
  const backIn = ro - 0.17;
  const shellIn = ro - 0.035;
  // Plinth, set back as a toe kick.
  ring(roundProfile(r0 + 0.06, backIn + 0.02, 0, seatTop - 0.095, 0.012), c.base, SATIN);
  // Seat cushion.
  ring(roundProfile(r0, backIn + 0.04, seatTop - 0.1, seatTop, 0.04), c.upholstery, UPHOLSTERY);
  // Tall back cushion with a soft roll on top, leaning out a touch.
  ring(
    [
      [backIn + 0.01, seatTop - 0.02],
      [shellIn, seatTop - 0.02],
      [shellIn, 0.99],
      ...arc(shellIn - 0.05, 0.99, 0.05, 0, Math.PI / 2, 5),
      ...arc(backIn + 0.08, 0.99, 0.045, Math.PI / 2, Math.PI, 5),
      [backIn + 0.03, 0.62],
      ...arc(backIn + 0.04, seatTop + 0.01, 0.03, Math.PI, Math.PI * 1.5, 3),
    ],
    c.upholstery,
    UPHOLSTERY,
  );
  // Wooden outer shell.
  ring([[shellIn, 0], [ro, 0], [ro, 1.0], ...arc(ro - 0.0175, 1.0, 0.0175, 0, Math.PI, 5), [shellIn, 0.995]], c.wood, SATIN);
  return merge(parts);
}

/** A rounded rectangle in the lathe's (radius, y) plane, wound so normals face out. */
function roundProfile(rIn: number, rOut: number, y0: number, y1: number, r: number): [number, number][] {
  const rr = Math.min(r, (rOut - rIn) / 2 - 1e-3, (y1 - y0) / 2 - 1e-3);
  return [
    ...arc(rIn + rr, y0 + rr, rr, Math.PI, Math.PI * 1.5, 3),
    ...arc(rOut - rr, y0 + rr, rr, Math.PI * 1.5, Math.PI * 2, 3),
    ...arc(rOut - rr, y1 - rr, rr, 0, Math.PI / 2, 4),
    ...arc(rIn + rr, y1 - rr, rr, Math.PI / 2, Math.PI, 4),
  ];
}

export function flipFaces(geo: THREE.BufferGeometry): THREE.BufferGeometry {
  if (geo.index) {
    const idx = geo.index.array as Uint16Array | Uint32Array;
    for (let i = 0; i < idx.length; i += 3) {
      const t = idx[i + 1]!;
      idx[i + 1] = idx[i + 2]!;
      idx[i + 2] = t;
    }
    geo.index.needsUpdate = true;
  }
  const n = geo.attributes.normal;
  if (n) {
    for (let i = 0; i < n.count; i++) n.setXYZ(i, -n.getX(i), -n.getY(i), -n.getZ(i));
    n.needsUpdate = true;
  }
  return geo;
}

/* ------------------------------------------------------------------ Tables */

/** The whole table group (top, base, chairs, bench, place settings) in local coordinates. */
export function tableGeometry(
  table: VenueTable,
  p: TablePlacement,
  c: FurnitureColors,
  arcDegrees: number,
): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const { width: w, depth: d } = p.size;
  const topY = TABLE_HEIGHT - TOP_THICKNESS;
  const topSurface: Surface = { roughness: 0.55, metalness: 0 };

  switch (table.shape) {
    case "round":
    case "booth": {
      const r = w / 2;
      const top = lathe(
        [
          [0, topY],
          [r - 0.012, topY],
          ...arc(r - 0.012, topY + 0.012, 0.012, -Math.PI / 2, 0, 3),
          ...arc(r - 0.012, TABLE_HEIGHT - 0.012, 0.012, 0, Math.PI / 2, 3),
          [0, TABLE_HEIGHT],
        ],
        32,
      );
      parts.push(paint(top, c.top, topSurface));
      parts.push(pedestal(table.shape === "booth" ? 0.26 : Math.min(0.3, r * 0.6), c.base, METAL));
      if (table.shape === "booth") parts.push(boothBenchGeometry(r, c, arcDegrees));
      break;
    }
    case "counter": {
      parts.push(
        paint(place(slab(roundedRectShape(w - 0.004, d, 0.018), 0.045, 0.01), 0, TABLE_HEIGHT - 0.045, 0), c.top, topSurface),
      );
      // A modesty panel on the far side, carrying the top.
      parts.push(paint(place(softBox(w - 0.06, TABLE_HEIGHT - 0.045, 0.04, 0.01), 0, 0, -(d / 2 - 0.09)), c.wood, SATIN));
      break;
    }
    default: {
      parts.push(paint(place(slab(roundedRectShape(w, d, 0.03), TOP_THICKNESS, 0.009, 3), 0, topY, 0), c.top, topSurface));
      if (c.outdoor) parts.push(...legs(w, d, 0.06, c.base, METAL, false));
      else if (table.shape === "rect") parts.push(...legs(w, d, 0.07, c.wood, SATIN, true));
      else parts.push(pedestal(w <= 0.72 ? 0.25 : 0.3, c.base, METAL));
    }
  }

  // Chairs at the exact seat positions and facings.
  const chair = chairGeometry(c);
  for (const s of p.chairs) {
    const local = worldToLocal(p, s.x, s.z);
    parts.push(place(chair.clone(), local.x, 0, local.z, s.rotationY - p.rotationY));
  }
  chair.dispose();

  // A place setting in front of every seat, and a votive in the middle.
  const spots: SettingSpot[] = [];
  const all = [...p.chairs.map((s) => ({ x: s.x, z: s.z, facing: s.facing })), ...p.benchSeats];
  for (const s of all) {
    const f = bearing(s.facing);
    const reach = CHAIR_GAP + (table.shape === "booth" ? 0.18 : 0.17);
    const local = worldToLocal(p, s.x + f.x * reach, s.z + f.z * reach);
    spots.push({ x: local.x, z: local.z, ry: -((s.facing * Math.PI) / 180) - p.rotationY });
  }
  parts.push(...settings(spots, c));
  parts.push(place(votiveGeometry(c.votive), 0, TABLE_HEIGHT, table.shape === "counter" ? -0.12 : 0));
  return merge(parts);
}

/** Matte clay for anything that should read as quiet furniture. */
export const QUIET_SURFACE = MATTE;
