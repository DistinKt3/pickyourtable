"use client";

import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useLayoutEffect, useMemo, useState } from "react";
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

/** The lights as plain three.js objects with the code that drives them. */
class LightRig {
  readonly hemi = new THREE.HemisphereLight();
  readonly key = new THREE.DirectionalLight();
  readonly pool = new THREE.SpotLight();
  readonly group = new THREE.Group();
  interior: THREE.PointLight[] = [];
  private palette: Palette | null = null;
  private poolAnim = { k: 0, from: 0, to: 0, start: 0 };

  constructor() {
    this.key.castShadow = true;
    this.key.shadow.bias = -0.0004;
    this.key.shadow.normalBias = 0.025;
    this.pool.angle = 0.55;
    this.pool.penumbra = 1;
    this.pool.decay = 1.3;
    this.pool.distance = 9;
    this.pool.intensity = 0;
    this.group.add(this.hemi, this.key, this.key.target, this.pool, this.pool.target);
  }

  configure(venue: Venue, palette: Palette, k: KeyLight, shadowMapSize: number, render: boolean, gl: THREE.WebGLRenderer) {
    this.palette = palette;
    const e = palette.exposure;
    this.hemi.color.set(palette.light.hemiSky);
    this.hemi.groundColor.set(palette.light.hemiGround);
    this.hemi.intensity = palette.light.hemi * e;
    this.key.color.set(palette.light.key);
    this.key.intensity = palette.light.keyIntensity * e;
    this.key.shadow.radius = render ? 9 : 5;
    this.key.shadow.intensity = palette.theme === "dark" ? 0.85 : 0.8;
    this.key.position.copy(k.center).addScaledVector(k.direction, 60);
    this.key.target.position.copy(k.center);
    const cam = this.key.shadow.camera;
    cam.left = -k.extent;
    cam.right = k.extent;
    cam.top = k.extent;
    cam.bottom = -k.extent;
    cam.near = 20;
    cam.far = 100;
    cam.updateProjectionMatrix();
    this.key.shadow.mapSize.set(shadowMapSize, shadowMapSize);
    this.key.shadow.map?.dispose();
    this.key.shadow.map = null;
    this.pool.color.set(palette.light.poolColor);
    // Warm interior fill only for the build-time seat renders: point lights cost every
    // fragment on a phone, so the live scene relies on the downlights and the palette.
    for (const l of this.interior) this.group.remove(l);
    this.interior = [];
    if (render) {
      const { width: W, depth: D, ceilingHeight: C } = venue.room;
      const nx = Math.max(2, Math.round(W / 6));
      const nz = Math.max(1, Math.round(D / 6));
      for (let i = 0; i < nx; i++) {
        for (let j = 0; j < nz; j++) {
          const l = new THREE.PointLight(palette.light.interior, palette.light.interiorIntensity * e, 9, 1.6);
          l.position.set((W / nx) * (i + 0.5), C - 0.4, (D / nz) * (j + 0.5));
          this.interior.push(l);
          this.group.add(l);
        }
      }
    }
    this.group.updateMatrixWorld(true);
    gl.shadowMap.needsUpdate = true;
  }

  environment(gl: THREE.WebGLRenderer, scene: THREE.Scene, palette: Palette, k: KeyLight): () => void {
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
    box(6, 3, 3, k.direction.clone().multiplyScalar(8));
    const pmrem = new THREE.PMREMGenerator(gl);
    const target = pmrem.fromScene(env, 0.04);
    scene.environment = target.texture;
    scene.environmentIntensity = palette.light.env;
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
  }

  /** Moves the pool of light to a table, or fades it out. */
  aim(table: { x: number; z: number } | null) {
    const a = this.poolAnim;
    a.from = a.k;
    a.to = table ? 1 : 0;
    a.start = performance.now();
    if (table) {
      this.pool.position.set(table.x, 3.4, table.z);
      this.pool.target.position.set(table.x, 0, table.z);
      this.pool.target.updateMatrixWorld();
    }
  }

  /** One frame; true while the pool is still fading. */
  step(now: number, sit: number, render: boolean): boolean {
    const p = this.palette;
    if (!p) return false;
    const a = this.poolAnim;
    const t = Math.min(1, (now - a.start) / 240);
    a.k = a.from + (a.to - a.from) * easeInOut(t);
    const e = p.exposure;
    this.pool.intensity = p.light.poolIntensity * e * a.k;
    // Everything else dims a touch under the pool, like a stage.
    const dimming = 1 - 0.08 * a.k;
    this.hemi.intensity = p.light.hemi * e * dimming;
    this.key.intensity = p.light.keyIntensity * e * dimming;
    const warm = render ? 1 : sit;
    for (const l of this.interior) l.intensity = p.light.interiorIntensity * e * warm;
    return t < 1;
  }
}

export function Lights({ venue, palette, shadowMapSize, render = false }: LightsProps) {
  const key = useMemo(() => keyLight(venue, palette), [venue, palette]);
  const get = useThree((s) => s.get);
  const invalidate = useThree((s) => s.invalidate);
  const rt = useRuntime();
  const selected = useRoom((s) => s.selected);
  const sitting = useRoom((s) => s.sitting);
  const [rig] = useState(() => new LightRig());

  useLayoutEffect(() => {
    rig.configure(venue, palette, key, shadowMapSize, render, get().gl);
    invalidate();
  }, [rig, venue, palette, key, shadowMapSize, render, get, invalidate]);

  useEffect(() => {
    const { gl, scene } = get();
    const cleanup = rig.environment(gl, scene, palette, key);
    invalidate();
    return cleanup;
  }, [rig, get, palette, key, invalidate]);

  useEffect(() => {
    rig.aim(selected && !sitting ? (venue.tables.find((x) => x.id === selected) ?? null) : null);
    invalidate();
  }, [rig, selected, sitting, venue.tables, invalidate]);

  useFrame((state) => {
    if (rig.step(performance.now(), rt.sit, render)) state.invalidate();
  });

  return <primitive object={rig.group} />;
}
