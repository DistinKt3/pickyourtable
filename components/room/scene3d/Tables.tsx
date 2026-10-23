"use client";

import { type ThreeEvent, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useLayoutEffect, useMemo, useState } from "react";
import * as THREE from "three";
import { useRoom } from "@/lib/room/store";
import { type RoomData, type RoomTable, tierOf, type VisualState, visualState } from "@/lib/room/types";
import { BOOTH_ARC_DEGREES, rotationY } from "@/lib/venue/geometry";
import { easeInOut } from "./cameraMath";
import { type FurnitureColors, tableGeometry } from "./geometry/furniture";
import type { TablePlacement } from "./layout";
import { type ClayMaterial, createClayMaterial, createRingMaterial, type SharedUniforms } from "./materials";
import type { Palette } from "./palette";
import { registerGroup, type Runtime, useRuntime } from "./runtime";

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
    plate: palette.plate,
    glassware: palette.theme === "dark" ? "#a7b2b6" : "#cdd8dc",
    votive: palette.votive,
    outdoor,
  };
}

function vivid(c: THREE.Color, amount: number): THREE.Color {
  const l = c.r * 0.2126 + c.g * 0.7152 + c.b * 0.0722;
  return c.setRGB(Math.max(0, l + (c.r - l) * amount), Math.max(0, l + (c.g - l) * amount), Math.max(0, l + (c.b - l) * amount));
}

interface LookContext {
  selected: boolean;
  hovered: boolean;
  someoneSelected: boolean;
  sitting: boolean;
  ringAlpha: number;
  ringFill: number;
}

/** The look a table should settle into for its state (PRD table states). */
export function targetLook(state: VisualState, c: LookContext): Look {
  if (c.sitting) {
    // At eye level the room is shown as it is: no rings, no ghosts, no lifts.
    return {
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
    };
  }
  const others = c.someoneSelected && !c.selected;
  const ringed = state === "available" || state === "wrong_size";
  return {
    lift: c.selected ? 0.02 : c.hovered ? 0.01 : 0,
    sat: state === "taken" ? 0.06 : state === "wrong_size" ? 0.16 : 1,
    dim: others ? 0.86 : state === "wrong_size" ? 0.97 : 1,
    opacity: state === "taken" ? 0.4 : 1,
    ringAlpha: ringed ? (state === "wrong_size" ? 0.7 : c.ringAlpha) * (others ? 0.5 : 1) : 0,
    ringLine: c.selected ? 3.2 : c.hovered ? 2.8 : 2,
    ringHatch: state === "wrong_size" ? 1 : 0,
    ringFill: c.selected ? c.ringFill : 0,
    ringGlow: c.selected ? 1 : c.hovered ? 0.55 : 0,
    ringBright: c.selected || c.hovered ? 1 : 0,
  };
}

interface Built {
  table: RoomTable;
  material: ClayMaterial;
}

interface RingBuffers {
  colorAttr: THREE.InstancedBufferAttribute;
  styleAttr: THREE.InstancedBufferAttribute;
  material: THREE.ShaderMaterial;
}

/** Owns each table's animation and pushes it into the meshes and ring buffers. */
class TableAnimator {
  private anims: Anim[] = [];
  private groups: (THREE.Group | null)[] = [];
  private meshes: (THREE.Mesh | null)[] = [];
  private ghosts: (THREE.Mesh | null)[] = [];
  private readonly color = new THREE.Color();

  setGroup(i: number, g: THREE.Group | null) {
    this.groups[i] = g;
  }

  setGhost(i: number, m: THREE.Mesh | null) {
    this.ghosts[i] = m;
  }

  setMesh(i: number, m: THREE.Mesh | null) {
    this.meshes[i] = m;
    if (m) m.layers.enable(SHADOW_LAYER);
  }

  /** New targets; true when the set of ghosted tables changed (baked shadows refresh). */
  retarget(looks: Look[], reducedMotion: boolean): boolean {
    const now = performance.now();
    looks.forEach((look, i) => {
      const prev = this.anims[i];
      if (!prev) {
        this.anims[i] = { from: { ...look }, to: { ...look }, now: { ...look }, start: now, duration: 0 };
        return;
      }
      prev.from = { ...prev.now };
      prev.to = look;
      prev.start = now;
      prev.duration = reducedMotion ? 120 : STATE_MS;
      if (reducedMotion) {
        prev.from.lift = look.lift;
        prev.now.lift = look.lift;
      }
    });
    // Ghosted tables neither cast shadows nor darken the baked contact shadow.
    let changed = false;
    looks.forEach((look, i) => {
      const mesh = this.meshes[i];
      if (!mesh) return;
      const cast = look.opacity >= 1;
      if (mesh.castShadow !== cast) {
        mesh.castShadow = cast;
        changed = true;
      }
      if (cast) mesh.layers.enable(SHADOW_LAYER);
      else mesh.layers.disable(SHADOW_LAYER);
    });
    return changed;
  }

  /** One frame; true while any table is still animating. */
  step(
    now: number,
    rt: Runtime,
    data: RoomData,
    built: Built[],
    rings: RingBuffers,
    tierColors: { base: THREE.Color; bright: THREE.Color }[],
    dpr: number,
  ): boolean {
    let animating = false;
    const sitFade = 1 - rt.sit;
    this.anims.forEach((a, i) => {
      const t = a.duration > 0 ? Math.min(1, (now - a.start) / a.duration) : 1;
      const k = easeInOut(t);
      for (const key of KEYS) a.now[key] = a.from[key] + (a.to[key] - a.from[key]) * k;
      if (t < 1) animating = true;
      const look = a.now;
      const g = this.groups[i];
      if (g) g.position.y = look.lift;
      rt.lift.set(data.tables[i]!.id, look.lift);
      const b = built[i]!;
      const u = b.material.userData.uniforms;
      u.uSat.value = look.sat;
      u.uDim.value = look.dim;
      b.material.opacity = look.opacity;
      const ghost = this.ghosts[i];
      if (ghost) ghost.visible = look.opacity < 0.999;
      const c = tierColors[i]!;
      this.color.copy(c.base).lerp(c.bright, look.ringBright);
      rings.colorAttr.setXYZW(i, this.color.r, this.color.g, this.color.b, look.ringAlpha * sitFade);
      rings.styleAttr.setXYZW(i, look.ringLine, look.ringHatch, look.ringFill, look.ringGlow);
    });
    rings.colorAttr.needsUpdate = true;
    rings.styleAttr.needsUpdate = true;
    rings.material.uniforms.uPixelRatio!.value = dpr;
    return animating;
  }
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
        // Tone mapping mutes saturated colors; push the ring color out from its gray first.
        const base = vivid(
          new THREE.Color(palette.theme === "dark" ? tier.colorDark : tier.color),
          palette.theme === "dark" ? 1.15 : 1.55,
        );
        const bright = vivid(base.clone().lerp(new THREE.Color("#ffffff"), palette.theme === "dark" ? 0.2 : 0.12), 1.15);
        return { base, bright };
      }),
    [data.tables, venue, palette.theme],
  );

  /* --------------------------------------------------------------- State */

  const [animator] = useState(() => new TableAnimator());
  const availability = useRoom((s) => s.availability);
  const hovered = useRoom((s) => s.hovered);
  const selected = useRoom((s) => s.selected);
  const sitting = useRoom((s) => s.sitting);

  useLayoutEffect(() => {
    const looks = data.tables.map((t) =>
      targetLook(visualState(t, availability?.[t.id]), {
        selected: selected === t.id,
        hovered: hovered === t.id,
        someoneSelected: selected != null,
        sitting: sitting != null,
        ringAlpha: palette.ringAlpha,
        ringFill: palette.ringFill,
      }),
    );
    // `built` changes with the palette: fresh meshes need their shadow flags again.
    if (animator.retarget(looks, reducedMotion) || built.length !== looks.length) onShadowsChanged();
    invalidate();
  }, [
    animator,
    availability,
    hovered,
    selected,
    sitting,
    data.tables,
    built,
    palette.ringAlpha,
    palette.ringFill,
    reducedMotion,
    invalidate,
    onShadowsChanged,
  ]);

  useFrame((state) => {
    if (animator.step(performance.now(), rt, data, built, rings, tierColors, state.viewport.dpr)) state.invalidate();
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
                animator.setGroup(i, g);
                registerGroup(rt, b.table.id, g);
              }}
              position={[p.position.x, p.position.y, p.position.z]}
              rotation={[0, p.rotationY, 0]}
              userData={{ code: b.table.id }}
            >
              <mesh
                ref={(m) => animator.setGhost(i, m)}
                geometry={b.geometry}
                material={b.ghost}
                renderOrder={0}
                visible={false}
              />
              <mesh
                ref={(m) => animator.setMesh(i, m)}
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
