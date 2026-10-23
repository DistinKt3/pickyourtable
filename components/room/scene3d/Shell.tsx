"use client";

import { type ThreeEvent, useFrame } from "@react-three/fiber";
import { lazy, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useRoom } from "@/lib/room/store";
import type { Venue } from "@/lib/venue/schema";
import { buildShell, type ShellGeometry } from "./geometry/shell";
import { keyLight } from "./Lights";
import {
  createClayMaterial,
  createGlassMaterial,
  createGroundMaterial,
  createSkyMaterial,
  createWaterMaterial,
  type FadeUniforms,
  type SharedUniforms,
} from "./materials";
import type { Palette } from "./palette";
import { useRuntime } from "./runtime";
import { SHADOW_LAYER } from "./Tables";

// The model loaders (GLTF, meshopt, KTX2) load only when a venue ships a model.
const ModelShell = lazy(() => import("./ModelShell"));

/**
 * The room shell (floors, cutaway walls, glass, fixtures), the seat-only pieces
 * (ceiling, downlights, headers, hood) and the surroundings (ground, quay, water, sky).
 * With a venue model (PRD D-2) the GLB replaces floors, walls and fixtures.
 */

export interface ShellProps {
  venue: Venue;
  palette: Palette;
  shared: SharedUniforms;
  fade: FadeUniforms;
  modelUrl: string | null;
}

function useMaterials(palette: Palette, shared: SharedUniforms, fade: FadeUniforms) {
  const m = useMemo(() => {
    const clay = createClayMaterial(shared);
    const sit = createClayMaterial(shared, { transparent: true });
    // Downlights glow whenever the ceiling shows, in daylight too.
    sit.userData.uniforms.uGlow = { value: 2.4 };
    sit.opacity = 0;
    const glass = createGlassMaterial(shared, palette.glass, palette.glassOpacity, palette.glassSheen);
    const ground = createGroundMaterial(fade);
    const water = createWaterMaterial(fade);
    const sky = createSkyMaterial();
    return { clay, sit, glass, ground, water, sky };
  }, [palette, shared, fade]);
  useEffect(
    () => () => {
      for (const x of Object.values(m)) x.dispose();
    },
    [m],
  );
  return m;
}

function onFloorClick(e: ThreeEvent<MouseEvent>) {
  if (e.delta > 8) return;
  const s = useRoom.getState();
  if (s.sitting) return;
  if (s.selected) s.select(null);
}

type Materials = ReturnType<typeof useMaterials>;

/** Pushes the palette and the site's geometry into the shared uniforms and materials. */
function applyPalette(
  geo: ShellGeometry,
  palette: Palette,
  shared: SharedUniforms,
  fade: FadeUniforms,
  mats: Materials,
  venue: Venue,
) {
  const [x0, z0, x1, z1] = geo.interiorRect;
  shared.uInteriorRect.value.set(x0, z0, x1, z1);
  shared.uInteriorColor.value.set(palette.interiorGlow);
  shared.uInteriorStrength.value = palette.interiorGlowStrength;
  shared.uGlow.value = palette.votiveGlow;
  shared.uGlassBody.value = palette.glassBody;
  fade.uFadeRect.value.set(...geo.siteRect);
  fade.uFade.value.set(0.6, 8.5);
  fade.uHaze.value.set(80, 1400);
  fade.uHazeColor.value.set(palette.sky.haze);
  const w = mats.water.uniforms;
  w.uDeep.value.set(palette.water.deep);
  w.uShallow.value.set(palette.water.shallow);
  w.uSkyZenith.value.set(palette.water.sky);
  w.uSkyHorizon.value.set(palette.sky.horizon);
  w.uSunDir.value.copy(keyLight(venue, palette).direction);
  w.uSunColor.value.set(palette.light.key);
  if (geo.shore) w.uShore.value.set(geo.shore.x, geo.shore.z, geo.shore.dx, geo.shore.dz);
  const s = mats.sky.uniforms;
  s.uSkyZenith.value.set(palette.sky.zenith);
  s.uSkyHorizon.value.set(palette.sky.horizon);
  s.uHazeColor.value.set(palette.sky.haze);
  s.uFar.value.set(palette.sky.far);
  s.uSilhouette.value = venue.surroundings.water ? 1 : 2;
}

/**
 * Seat-view progress: walls rise to the ceiling, the ceiling and downlights fade in,
 * and the page backdrop gives way to the real horizon.
 */
function applySit(
  k: number,
  venue: Venue,
  shared: SharedUniforms,
  fade: FadeUniforms,
  mats: Materials,
  sitMesh: THREE.Mesh | null,
  sky: THREE.Mesh | null,
  camera: THREE.Camera,
) {
  shared.uRise.value = k * (venue.room.ceilingHeight - venue.room.wallHeight);
  const show = Math.min(1, Math.max(0, (k - 0.35) / 0.6));
  mats.sit.opacity = show;
  mats.sit.depthWrite = show > 0.98;
  if (sitMesh) sitMesh.visible = show > 0.001;
  fade.uBgMix.value = 1 - k;
  mats.sky.uniforms.uBgMix.value = 1 - k;
  if (sky) sky.position.copy(camera.position);
}

export function Shell({ venue, palette, shared, fade, modelUrl }: ShellProps) {
  const geo = useMemo<ShellGeometry>(() => buildShell(venue, palette, venue.brand.accent), [venue, palette]);
  useEffect(
    () => () => {
      geo.clay.dispose();
      geo.glass.dispose();
      geo.sitOnly.dispose();
      geo.ground.dispose();
      geo.water?.dispose();
    },
    [geo],
  );
  const mats = useMaterials(palette, shared, fade);
  const rt = useRuntime();
  const sitMesh = useRef<THREE.Mesh>(null);
  const sky = useRef<THREE.Mesh>(null);

  useLayoutEffect(() => applyPalette(geo, palette, shared, fade, mats, venue), [geo, palette, shared, fade, mats, venue]);
  useFrame((state) => applySit(rt.sit, venue, shared, fade, mats, sitMesh.current, sky.current, state.camera));

  return (
    <group>
      {modelUrl ? (
        <ModelShell url={modelUrl} clay={mats.clay} glass={mats.glass} />
      ) : (
        <>
          <mesh
            geometry={geo.clay}
            material={mats.clay}
            castShadow
            receiveShadow
            ref={(m) => {
              if (m) m.layers.enable(SHADOW_LAYER);
            }}
          />
          <mesh geometry={geo.glass} material={mats.glass} renderOrder={3} />
        </>
      )}
      <mesh ref={sitMesh} geometry={geo.sitOnly} material={mats.sit} visible={false} renderOrder={2} />
      <mesh geometry={geo.ground} material={mats.ground} receiveShadow />
      {geo.water ? <mesh geometry={geo.water} material={mats.water} /> : null}
      <mesh ref={sky} material={mats.sky} renderOrder={-10} frustumCulled={false}>
        <sphereGeometry args={[2000, 32, 16]} />
      </mesh>
      {/* Tapping empty floor (without dragging) clears the selection. */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[geo.fadeCenter.x, 0.001, geo.fadeCenter.z]} onClick={onFloorClick}>
        <planeGeometry args={[geo.siteRadius * 4, geo.siteRadius * 4]} />
        <meshBasicMaterial visible={false} />
      </mesh>
    </group>
  );
}
