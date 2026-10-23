"use client";

import { type ThreeEvent, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useRoom } from "@/lib/room/store";
import { type RoomData, tierOf, visualState } from "@/lib/room/types";
import { BOOTH_ARC_DEGREES, rotationY } from "@/lib/venue/geometry";
import { easeInOut } from "./cameraMath";
import { type FurnitureColors, tableGeometry } from "./geometry/furniture";
import type { TablePlacement } from "./layout";
import { type ClayMaterial, createClayMaterial, createRingMaterial, type SharedUniforms } from "./materials";
import type { Palette } from "./palette";
import { useRuntime } from "./runtime";

/**
 * Every table as one merged mesh with its own material instance (one shared program),
 * floor rings for all tables in one instanced draw, and invisible hit proxies that
 * match each ring. Visual state (lift, saturation, dimming, opacity, ring style)
 * animates over 200 ms, eased.
 */

export const STATE_MS = 200;
export const SHADOW_LAYER = 1;
const RING_Y = 0.012;
const RING_PAD = 0.25;

interface Look {
  lift: number;
  sat: number;
  dim: number;
  opacity: number;
  ringAlpha: number;
  ringLine: number;
  ringHatch: number;
  ringFill: number;
  ringGlow: number;
  ringBright: number;
}

const KEYS: (keyof Look)[] = [
  "lift",
  "sat",
  "dim",
  "opacity",
  "ringAlpha",
  "ringLine",
  "ringHatch",
  "ringFill",
  "ringGlow",
  "ringBright",
];

interface Anim {
  from: Look;
  to: Look;
  now: Look;
  start: number;
  duration: number;
}

function furnitureColors(palette: Palette, bookable: boolean, tierColor: string, outdoor: boolean): FurnitureColors {
  const upholstery = bookable
    ? `#${new THREE.Color(palette.upholsteryBase).lerp(new THREE.Color(tierColor), palette.upholsteryTint).getHexString()}`
    : palette.upholsteryQuiet;
  return {
    top: bookable ? palette.tableTop : palette.tableTopQuiet,
    base: palette.metal,
    wood: bookable ? palette.chairWood : palette.chairWoodQuiet,
    upholstery,
    plate: palette.votive,
    glassware: palette.theme === "dark" ? "#7f8b90" : "#e6ecee",
    votive: palette.votive,
    outdoor,
  };
}

export interface TablesProps {
  data: RoomData;
  placements: TablePlacement[];
  palette: Palette;
  shared: SharedUniforms;
  reducedMotion: boolean;
  /** Called when the set of ghosted tables changes, so baked shadows can refresh. */
  onShadowsChanged: () => void;
}

export function Tables({ data, placements, palette, shared, reducedMotion, onShadowsChanged }: TablesProps) {
  const rt = useRuntime();
  const invalidate = useThree((s) => s.invalidate);
  const dpr = useThree((s) => s.viewport.dpr);
  const venue = data.venue;

  const built = useMemo(() => {
    return data.tables.map((t, i) => {
      const p = placements[i]!;
      const tier = tierOf(venue, t.tier);
      const outdoor = t.attributes.includes("outdoor");
      const geometry = tableGeometry(t, p, furnitureColors(palette, t.bookable, tier.color, outdoor), BOOTH_ARC_DEGREES);
      const material = createClayMaterial(shared, { transparent: true });
      const ghost = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: true, transparent: true });
      return { table: t, placement: p, geometry, material, ghost };
    });
  }, [data.tables, placements, palette, shared, venue]);

  useEffect(
    () => () => {
      for (const b of built) {
        b.geometry.dispose();
        b.material.dispose();
        b.ghost.dispose();
      }
    },
    [built],
  );

  /* ---------------------------------------------------------------- Rings */

  const rings = useMemo(() => {
    const quad = new THREE.PlaneGeometry(2, 2);
    quad.rotateX(-Math.PI / 2);
    const material = createRingMaterial();
    const mesh = new THREE.InstancedMesh(quad, material, placements.length);
    const shape = new Float32Array(placements.length * 4);
    const color = new Float32Array(placements.length * 4);
    const style = new Float32Array(placements.length * 4);
    const m = new THREE.Matrix4();
    placements.forEach((p, i) => {
      const r = p.ring;
      if (r.kind === "circle") {
        shape.set([r.r + RING_PAD, r.r + RING_PAD, r.r, 0], i * 4);
        m.makeTranslation(r.x, RING_Y, r.z);
      } else {
        shape.set([r.width / 2 + RING_PAD, r.depth / 2 + RING_PAD, r.corner, 1], i * 4);
        m.makeRotationY(rotationY(r.rotation)).setPosition(r.x, RING_Y, r.z);
      }
      mesh.setMatrixAt(i, m);
    });
    quad.setAttribute("aShape", new THREE.InstancedBufferAttribute(shape, 4));
    const colorAttr = new THREE.InstancedBufferAttribute(color, 4);
    const styleAttr = new THREE.InstancedBufferAttribute(style, 4);
    colorAttr.setUsage(THREE.DynamicDrawUsage);
    styleAttr.setUsage(THREE.DynamicDrawUsage);
    quad.setAttribute("aColor", colorAttr);
    quad.setAttribute("aStyle", styleAttr);
    mesh.frustumCulled = false;
    mesh.renderOrder = 1;
    mesh.instanceMatrix.needsUpdate = true;
    return { mesh, material, colorAttr, styleAttr, quad };
  }, [placements]);

  useEffect(
    () => () => {
      rings.quad.dispose();
      rings.material.dispose();
      rings.mesh.dispose();
    },
    [rings],
  );

  const tierColors = useMemo(
    () =>
      data.tables.map((t) => {
        const tier = tierOf(venue, t.tier);
        const base = new THREE.Color(palette.theme === "dark" ? tier.colorDark : tier.color);
        const bright = base.clone().lerp(new THREE.Color("#ffffff"), palette.theme === "dark" ? 0.22 : 0.18);
        return { base, bright };
      }),
    [data.tables, venue, palette.theme],
  );

  /* --------------------------------------------------------------- State */

  const anims = useRef<Anim[]>([]);
  const groups = useRef<(THREE.Group | null)[]>([]);
  const meshes = useRef<(THREE.Mesh | null)[]>([]);
  const ghosts = useRef<(THREE.Mesh | null)[]>([]);

  const availability = useRoom((s) => s.availability);
  const hovered = useRoom((s) => s.hovered);
  const selected = useRoom((s) => s.selected);
  const sitting = useRoom((s) => s.sitting);

  useLayoutEffect(() => {
    const now = performance.now();
    const ghosted: boolean[] = [];
    data.tables.forEach((t, i) => {
      const state = visualState(t, availability?.[t.id]);
      const isSel = selected === t.id;
      const isHover = hovered === t.id || rt.focused === t.id;
      const others = selected != null && !isSel;
      const ringed = state === "available" || state === "wrong_size";
      const look: Look = sitting
        ? {
            lift: 0,
            sat: 1,
            dim: 1,
            opacity: 1,
            ringAlpha: 0,
            ringLine: 2,
            ringHatch: 0,
            ringFill: 0,
            ringGlow: 0,
            ringBright: 0,
          }
        : {
            lift: isSel ? 0.02 : isHover ? 0.01 : 0,
            sat: state === "taken" ? 0.06 : state === "wrong_size" ? 0.16 : 1,
            dim: others ? 0.86 : state === "wrong_size" ? 0.97 : 1,
            opacity: state === "taken" ? 0.4 : 1,
            ringAlpha: ringed ? (state === "wrong_size" ? 0.7 : palette.ringAlpha) * (others ? 0.5 : 1) : 0,
            ringLine: isSel ? 3.2 : isHover ? 2.8 : 2,
            ringHatch: state === "wrong_size" ? 1 : 0,
            ringFill: isSel ? 1 : 0,
            ringGlow: isSel ? 1 : isHover ? 0.55 : 0,
            ringBright: isSel || isHover ? 1 : 0,
          };
      ghosted.push(look.opacity < 1);
      const prev = anims.current[i];
      if (!prev) {
        anims.current[i] = { from: { ...look }, to: { ...look }, now: { ...look }, start: now, duration: 0 };
      } else {
        prev.from = { ...prev.now };
        prev.to = look;
        prev.start = now;
        prev.duration = reducedMotion ? 120 : STATE_MS;
        if (reducedMotion) {
          prev.from.lift = look.lift;
          prev.now.lift = look.lift;
        }
      }
    });
    // Ghosted tables neither cast shadows nor darken the baked contact shadow.
    let changed = false;
    built.forEach((b, i) => {
      const mesh = meshes.current[i];
      if (!mesh) return;
      const cast = !ghosted[i];
      if (mesh.castShadow !== cast) {
        mesh.castShadow = cast;
        changed = true;
      }
      if (cast) mesh.layers.enable(SHADOW_LAYER);
      else mesh.layers.disable(SHADOW_LAYER);
    });
    if (changed) onShadowsChanged();
    invalidate();
  }, [
    availability,
    hovered,
    selected,
    sitting,
    data.tables,
    built,
    palette.ringAlpha,
    reducedMotion,
    invalidate,
    onShadowsChanged,
    rt,
  ]);

  useFrame(() => {
    const now = performance.now();
    let animating = false;
    const sitFade = 1 - rt.sit;
    anims.current.forEach((a, i) => {
      const t = a.duration > 0 ? Math.min(1, (now - a.start) / a.duration) : 1;
      const k = easeInOut(t);
      for (const key of KEYS) a.now[key] = a.from[key] + (a.to[key] - a.from[key]) * k;
      if (t < 1) animating = true;
      const look = a.now;
      const g = groups.current[i];
      if (g) g.position.y = look.lift;
      rt.lift.set(data.tables[i]!.id, look.lift);
      const b = built[i]!;
      const u = (b.material as ClayMaterial).userData.uniforms;
      u.uSat.value = look.sat;
      u.uDim.value = look.dim;
      b.material.opacity = look.opacity;
      const ghost = ghosts.current[i];
      if (ghost) ghost.visible = look.opacity < 0.999;
      const c = tierColors[i]!;
      const col = c.base.clone().lerp(c.bright, look.ringBright);
      rings.colorAttr.setXYZW(i, col.r, col.g, col.b, look.ringAlpha * sitFade);
      rings.styleAttr.setXYZW(i, look.ringLine, look.ringHatch, look.ringFill, look.ringGlow);
    });
    rings.colorAttr.needsUpdate = true;
    rings.styleAttr.needsUpdate = true;
    rings.material.uniforms.uPixelRatio!.value = dpr;
    if (animating) invalidate();
  });

  /* ---------------------------------------------------------------- Input */

  const hover = useRoom((s) => s.hover);
  const select = useRoom((s) => s.select);

  const onOver = (code: string) => (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    if (useRoom.getState().sitting) return;
    hover(code);
    document.body.style.cursor = "pointer";
  };
  const onOut = (code: string) => () => {
    if (useRoom.getState().hovered === code) hover(null);
    document.body.style.cursor = "";
  };
  const onClick = (code: string) => (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    if (e.delta > 8 || useRoom.getState().sitting) return;
    select(code);
  };

  useEffect(() => () => void (document.body.style.cursor = ""), []);

  return (
    <group>
      <primitive object={rings.mesh} />
      {built.map((b, i) => {
        const p = b.placement;
        const r = p.ring;
        return (
          <group key={b.table.id}>
            <group
              ref={(g) => {
                groups.current[i] = g;
                if (g) rt.groups.set(b.table.id, g);
                else rt.groups.delete(b.table.id);
              }}
              position={[p.position.x, p.position.y, p.position.z]}
              rotation={[0, p.rotationY, 0]}
              userData={{ code: b.table.id }}
            >
              <mesh
                ref={(m) => {
                  ghosts.current[i] = m;
                }}
                geometry={b.geometry}
                material={b.ghost}
                renderOrder={0}
                visible={false}
              />
              <mesh
                ref={(m) => {
                  meshes.current[i] = m;
                  if (m) m.layers.enable(SHADOW_LAYER);
                }}
                geometry={b.geometry}
                material={b.material}
                castShadow
                receiveShadow
                renderOrder={1}
              />
            </group>
            <mesh
              position={[r.x, 0.5, r.z]}
              rotation={[0, r.kind === "rect" ? rotationY(r.rotation) : 0, 0]}
              onPointerOver={onOver(b.table.id)}
              onPointerOut={onOut(b.table.id)}
              onClick={onClick(b.table.id)}
            >
              {r.kind === "circle" ? <cylinderGeometry args={[r.r, r.r, 1, 24]} /> : <boxGeometry args={[r.width, 1, r.depth]} />}
              <meshBasicMaterial visible={false} />
            </mesh>
          </group>
        );
      })}
    </group>
  );
}
