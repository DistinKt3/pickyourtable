"use client";

import { type ThreeEvent, useFrame, useLoader, useThree } from "@react-three/fiber";
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { type GLTF, GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { KTX2Loader } from "three/examples/jsm/loaders/KTX2Loader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { useRoom } from "@/lib/room/store";
import type { Venue } from "@/lib/venue/schema";
import { buildShell, type ShellGeometry } from "./geometry/shell";
import { keyLight } from "./Lights";
import {
  type ClayMaterial,
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

export const BASIS_PATH = "/vendor/basis/";

function useMaterials(palette: Palette, shared: SharedUniforms, fade: FadeUniforms) {
  const m = useMemo(() => {
    const clay = createClayMaterial(shared);
    const sit = createClayMaterial(shared, { transparent: true });
    // Downlights glow whenever the ceiling shows, in daylight too.
    sit.userData.uniforms.uGlow = { value: 2.4 };
    sit.opacity = 0;
    const glass = createGlassMaterial(shared, palette.glass, palette.glassOpacity);
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
  const camera = useThree((s) => s.camera);
  const sitMesh = useRef<THREE.Mesh>(null);
  const sky = useRef<THREE.Mesh>(null);

  useLayoutEffect(() => {
    const [x0, z0, x1, z1] = geo.interiorRect;
    shared.uInteriorRect.value.set(x0, z0, x1, z1);
    shared.uInteriorColor.value.set(palette.interiorGlow);
    shared.uInteriorStrength.value = palette.interiorGlowStrength;
    shared.uGlow.value = palette.votiveGlow;
    fade.uFadeRect.value.set(...geo.siteRect);
    fade.uFade.value.set(1.2, 11);
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
  }, [geo, palette, shared, fade, mats, venue]);

  useFrame(() => {
    const k = rt.sit;
    shared.uRise.value = k * (venue.room.ceilingHeight - venue.room.wallHeight);
    const show = Math.min(1, Math.max(0, (k - 0.35) / 0.6));
    mats.sit.opacity = show;
    mats.sit.depthWrite = show > 0.98;
    if (sitMesh.current) sitMesh.current.visible = show > 0.001;
    fade.uBgMix.value = 1 - k;
    mats.sky.uniforms.uBgMix.value = 1 - k;
    if (sky.current) sky.current.position.copy(camera.position);
  });

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

/* --------------------------------------------------------------- GLB shell */

let ktx2: KTX2Loader | null = null;

/**
 * A venue model (PRD D-2): meshopt geometry and KTX2 textures are supported. Meshes
 * exported from this builder keep their clay attributes (`_pbr`, `_rise`, `_pattern`)
 * and get the live clay material back, so walls still rise for seat views.
 */
function ModelShell({ url, clay, glass }: { url: string; clay: ClayMaterial; glass: THREE.Material }) {
  const gl = useThree((s) => s.gl);
  const gltf = useLoader(GLTFLoader, url, (loader) => {
    loader.setMeshoptDecoder(MeshoptDecoder);
    if (!ktx2) ktx2 = new KTX2Loader().setTranscoderPath(BASIS_PATH).detectSupport(gl);
    loader.setKTX2Loader(ktx2);
  }) as GLTF;
  const scene = useMemo(() => {
    const root = gltf.scene.clone(true);
    root.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      const g = o.geometry as THREE.BufferGeometry;
      for (const [from, to] of [
        ["_pbr", "pbr"],
        ["_rise", "rise"],
        ["_pattern", "pattern"],
      ] as const) {
        const attr = g.getAttribute(from);
        if (attr) {
          g.setAttribute(to, attr);
          g.deleteAttribute(from);
        }
      }
      const n = g.attributes.position!.count;
      if (o.name.startsWith("glass")) {
        if (!g.getAttribute("rise")) g.setAttribute("rise", new THREE.BufferAttribute(new Float32Array(n), 1));
        o.material = glass;
        o.renderOrder = 3;
        return;
      }
      if (g.getAttribute("pbr") && g.getAttribute("color")) {
        if (!g.getAttribute("rise")) g.setAttribute("rise", new THREE.BufferAttribute(new Float32Array(n), 1));
        if (!g.getAttribute("pattern")) g.setAttribute("pattern", new THREE.BufferAttribute(new Float32Array(n), 1));
        o.material = clay;
      }
      o.castShadow = true;
      o.receiveShadow = true;
      o.layers.enable(SHADOW_LAYER);
    });
    return root;
  }, [gltf, clay, glass]);
  return <primitive object={scene} />;
}
