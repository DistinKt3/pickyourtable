"use client";

import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { planOrientation } from "@/lib/room/orientation";
import { useRoom } from "@/lib/room/store";
import { bearing, boundsCenter, rad, siteBounds } from "@/lib/venue/geometry";
import type { Venue } from "@/lib/venue/schema";
import { easeInOut } from "./cameraMath";
import type { Palette } from "./palette";
import { useRuntime } from "./runtime";

/**
 * Hemisphere fill plus one soft key light with a soft shadow, a generated environment
 * for the gentle sheen on clay and glass, and the soft pool of light over the
 * selected table. The key light sits behind and to the left of the landscape view,
 * so shadows fall away from the guest.
 */

export interface KeyLight {
  direction: THREE.Vector3;
  center: THREE.Vector3;
  extent: number;
}

export function keyLight(venue: Venue, palette: Palette): KeyLight {
  const b = siteBounds(venue);
  const c = boundsCenter(b);
  const az = planOrientation(venue, 1.6) + 180 + 38;
  const f = bearing(az);
  const el = rad(palette.light.keyElevation);
  const direction = new THREE.Vector3(f.x * Math.cos(el), Math.sin(el), f.z * Math.cos(el)).normalize();
  const extent = Math.hypot(b.maxX - b.minX, b.maxZ - b.minZ) / 2 + 2;
  return { direction, center: new THREE.Vector3(c.x, 0, c.z), extent };
}

export interface LightsProps {
  venue: Venue;
  palette: Palette;
  shadowMapSize: number;
  /** Seat renders: brighter downlights and a warmer interior. */
  render?: boolean;
}

export function Lights({ venue, palette, shadowMapSize, render = false }: LightsProps) {
  const key = useMemo(() => keyLight(venue, palette), [venue, palette]);
  const dir = useRef<THREE.DirectionalLight>(null);
  const spot = useRef<THREE.SpotLight>(null);
  const hemi = useRef<THREE.HemisphereLight>(null);
  const interior = useRef<THREE.PointLight[]>([]);
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const invalidate = useThree((s) => s.invalidate);
  const rt = useRuntime();
  const selected = useRoom((s) => s.selected);
  const sitting = useRoom((s) => s.sitting);
  const exposure = palette.exposure;

  useLayoutEffect(() => {
    const l = dir.current;
    if (!l) return;
    l.position.copy(key.center).addScaledVector(key.direction, 60);
    l.target.position.copy(key.center);
    l.target.updateMatrixWorld();
    const cam = l.shadow.camera;
    cam.left = -key.extent;
    cam.right = key.extent;
    cam.top = key.extent;
    cam.bottom = -key.extent;
    cam.near = 20;
    cam.far = 100;
    cam.updateProjectionMatrix();
    l.shadow.mapSize.set(shadowMapSize, shadowMapSize);
    l.shadow.map?.dispose();
    l.shadow.map = null;
    gl.shadowMap.needsUpdate = true;
    invalidate();
  }, [key, shadowMapSize, gl, invalidate]);

  /* ---------------------------------------------------------- Environment */

  useEffect(() => {
    const env = new THREE.Scene();
    const sky = new THREE.Mesh(
      new THREE.SphereGeometry(10, 32, 16),
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        uniforms: {
          top: { value: new THREE.Color(palette.sky.zenith).multiplyScalar(1.1) },
          mid: { value: new THREE.Color(palette.sky.horizon) },
          bottom: { value: new THREE.Color(palette.light.hemiGround).multiplyScalar(0.6) },
        },
        vertexShader:
          "varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }",
        fragmentShader:
          "uniform vec3 top; uniform vec3 mid; uniform vec3 bottom; varying vec3 vP; void main(){ float h = normalize(vP).y; vec3 c = h > 0.0 ? mix(mid, top, pow(h, 0.6)) : mix(mid, bottom, pow(-h, 0.5)); gl_FragColor = vec4(c, 1.0); }",
      }),
    );
    env.add(sky);
    // Two soft boxes: a broad one overhead and one on the key side.
    const box = (w: number, h: number, intensity: number, pos: THREE.Vector3) => {
      const m = new THREE.Mesh(
        new THREE.PlaneGeometry(w, h),
        new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.97, 0.92).multiplyScalar(intensity), side: THREE.DoubleSide }),
      );
      m.position.copy(pos);
      m.lookAt(0, 0, 0);
      env.add(m);
    };
    box(9, 9, 2.2, new THREE.Vector3(0, 8, 0));
    box(6, 3, 3, key.direction.clone().multiplyScalar(8));
    const pmrem = new THREE.PMREMGenerator(gl);
    const target = pmrem.fromScene(env, 0.04);
    scene.environment = target.texture;
    scene.environmentIntensity = palette.light.env;
    invalidate();
    return () => {
      scene.environment = null;
      target.dispose();
      pmrem.dispose();
      env.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          o.geometry.dispose();
          (o.material as THREE.Material).dispose();
        }
      });
    };
  }, [gl, scene, palette, key, invalidate]);

  /* ------------------------------------------------------------ The pool */

  const pool = useRef({ k: 0, from: 0, to: 0, start: 0, x: 0, z: 0 });
  useEffect(() => {
    const p = pool.current;
    const t = selected && !sitting ? venue.tables.find((x) => x.id === selected) : null;
    p.from = p.k;
    p.to = t ? 1 : 0;
    p.start = performance.now();
    if (t) {
      p.x = t.x;
      p.z = t.z;
    }
    invalidate();
  }, [selected, sitting, venue.tables, invalidate]);

  useFrame(() => {
    const p = pool.current;
    const t = Math.min(1, (performance.now() - p.start) / 240);
    p.k = p.from + (p.to - p.from) * easeInOut(t);
    if (t < 1) invalidate();
    const s = spot.current;
    if (s) {
      s.position.set(p.x, 3.4, p.z);
      s.target.position.set(p.x, 0, p.z);
      s.target.updateMatrixWorld();
      s.intensity = palette.light.poolIntensity * exposure * p.k;
    }
    // Everything else dims a touch under the pool, like a stage.
    const dimming = 1 - 0.08 * p.k;
    if (hemi.current) hemi.current.intensity = palette.light.hemi * exposure * dimming;
    if (dir.current) dir.current.intensity = palette.light.keyIntensity * exposure * dimming;
    const warm = render ? 1 : rt.sit;
    for (const l of interior.current) if (l) l.intensity = palette.light.interiorIntensity * exposure * warm;
  });

  const W = venue.room.width;
  const D = venue.room.depth;
  const C = venue.room.ceilingHeight;
  // Warm interior fill only for the build-time seat renders: point lights cost every
  // fragment on a phone, so the live scene relies on the downlights and the palette.
  const points = useMemo(() => {
    const out: [number, number, number][] = [];
    if (!render) return out;
    const nx = Math.max(2, Math.round(W / 6));
    const nz = Math.max(1, Math.round(D / 6));
    for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) out.push([(W / nx) * (i + 0.5), C - 0.4, (D / nz) * (j + 0.5)]);
    return out;
  }, [W, D, C, render]);

  return (
    <>
      <hemisphereLight ref={hemi} args={[palette.light.hemiSky, palette.light.hemiGround, palette.light.hemi * exposure]} />
      <directionalLight
        ref={dir}
        color={palette.light.key}
        intensity={palette.light.keyIntensity * exposure}
        castShadow
        shadow-bias={-0.0004}
        shadow-normalBias={0.025}
        shadow-radius={render ? 9 : 5}
        shadow-intensity={palette.theme === "dark" ? 0.75 : 0.62}
      />
      <spotLight ref={spot} color={palette.light.poolColor} intensity={0} angle={0.55} penumbra={1} decay={1.3} distance={9} />
      {points.map((p, i) => (
        <pointLight
          key={i}
          ref={(l) => {
            if (l) interior.current[i] = l;
          }}
          position={p}
          color={palette.light.interior}
          intensity={0}
          distance={9}
          decay={1.6}
        />
      ))}
    </>
  );
}
