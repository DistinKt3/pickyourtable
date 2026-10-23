"use client";

import { PerformanceMonitor } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { useRoom } from "@/lib/room/store";
import type { RoomData } from "@/lib/room/types";
import { CameraRig, livePitch } from "./CameraRig";
import { ContactShadows } from "./ContactShadows";
import { Effects, type Quality } from "./Effects";
import { LabelProjector } from "./Labels";
import { tablePlacements } from "./layout";
import { Lights } from "./Lights";
import { createFadeUniforms, createSharedUniforms } from "./materials";
import type { Palette } from "./palette";
import { useRuntime } from "./runtime";
import { Shell } from "./Shell";
import { Tables } from "./Tables";

export interface SceneTestHook {
  ready: boolean;
  tablePositions(): Record<string, { x: number; y: number; z: number }>;
  labels(): { code: string; visible: boolean; rect: { x: number; y: number; width: number; height: number } }[];
  camera(): {
    position: { x: number; y: number; z: number };
    target: { x: number; y: number; z: number };
    fov: number;
    pitch: number;
  };
  info(): { drawCalls: number; triangles: number };
}

declare global {
  interface Window {
    __pytScene?: SceneTestHook;
  }
}

const SHADOW_SIZE: Record<Quality, number> = { 0: 1024, 1: 1536, 2: 2048 };
const DPR: Record<Quality, number> = { 0: 1, 1: 1.5, 2: 2 };

export interface SceneProps {
  data: RoomData;
  palette: Palette;
  background: string;
  reducedMotion: boolean;
  onReady?: () => void;
}

export function Scene({ data, palette, background, reducedMotion, onReady }: SceneProps) {
  const rt = useRuntime();
  const gl = useThree((s) => s.gl);
  const invalidate = useThree((s) => s.invalidate);
  const setDpr = useThree((s) => s.setDpr);
  const placements = useMemo(() => tablePlacements(data.venue), [data.venue]);
  const shared = useMemo(() => createSharedUniforms(), []);
  const fade = useMemo(() => createFadeUniforms(), []);
  const [quality, setQuality] = useState<Quality>(2);
  const [shadowVersion, setShadowVersion] = useState(0);

  rt.invalidate = invalidate;

  useEffect(() => {
    gl.shadowMap.autoUpdate = false;
    gl.shadowMap.needsUpdate = true;
    gl.setClearColor(0x000000, 0);
  }, [gl]);

  useEffect(() => {
    setDpr(Math.min(window.devicePixelRatio || 1, DPR[quality]));
  }, [quality, setDpr]);

  const onShadowsChanged = useCallback(() => {
    gl.shadowMap.needsUpdate = true;
    setShadowVersion((v) => v + 1);
  }, [gl]);

  useEffect(() => {
    gl.shadowMap.needsUpdate = true;
    setShadowVersion((v) => v + 1);
  }, [palette, gl]);

  return (
    <>
      <PerformanceMonitor
        flipflops={3}
        onDecline={() => setQuality((q) => (q > 0 ? ((q - 1) as Quality) : q))}
        onIncline={() => setQuality((q) => (q < 2 ? ((q + 1) as Quality) : q))}
      />
      <Lights venue={data.venue} palette={palette} shadowMapSize={SHADOW_SIZE[quality]} />
      <CameraRig venue={data.venue} reducedMotion={reducedMotion} />
      <Suspense fallback={null}>
        <Shell venue={data.venue} palette={palette} shared={shared} fade={fade} modelUrl={data.modelUrl} />
        <Tables
          data={data}
          placements={placements}
          palette={palette}
          shared={shared}
          reducedMotion={reducedMotion}
          onShadowsChanged={onShadowsChanged}
        />
        <ContactShadows
          venue={data.venue}
          version={shadowVersion}
          opacity={palette.contactShadow}
          resolution={quality === 0 ? 512 : 1024}
        />
        <LabelProjector data={data} />
        <Ready onReady={onReady} />
      </Suspense>
      <Effects background={background} quality={quality} aoIntensity={palette.ao.intensity} aoColor={palette.ao.color} />
      <Stats />
    </>
  );
}

/** Snapshot of renderer.info for the whole frame, including the post passes. */
function Stats() {
  const gl = useThree((s) => s.gl);
  const rt = useRuntime();
  useEffect(() => {
    gl.info.autoReset = false;
    return () => void (gl.info.autoReset = true);
  }, [gl]);
  useFrame(() => gl.info.reset(), -100);
  useFrame(() => {
    rt.stats = { drawCalls: gl.info.render.calls, triangles: gl.info.render.triangles };
  }, 100);
  return null;
}

/**
 * Compiles every program up front, waits for two complete frames, then reports
 * ready: the first frame the lead cross-fades in is final, with no shader hitch.
 */
function Ready({ onReady }: { onReady?: () => void }) {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);
  const invalidate = useThree((s) => s.invalidate);
  const rt = useRuntime();
  const frames = useRef(-1);
  const done = useRef(false);
  const cb = useRef(onReady);
  cb.current = onReady;

  useEffect(() => {
    let cancelled = false;
    void gl
      .compileAsync(scene, camera)
      .catch(() => undefined)
      .then(() => {
        if (cancelled) return;
        frames.current = 0;
        invalidate();
      });
    return () => {
      cancelled = true;
    };
  }, [gl, scene, camera, invalidate]);

  useFrame(() => {
    if (done.current || frames.current < 0) return;
    frames.current += 1;
    if (frames.current < 3) {
      invalidate();
      return;
    }
    done.current = true;
    rt.ready = true;
    if (window.__pytScene) window.__pytScene.ready = true;
    cb.current?.();
  }, 200);
  return null;
}

/** `window.__pytScene` while mounted: what the lead's layout-truth and label tests read. */
export function TestHook() {
  const rt = useRuntime();
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  useEffect(() => {
    const hook: SceneTestHook = {
      ready: rt.ready,
      tablePositions() {
        const out: Record<string, { x: number; y: number; z: number }> = {};
        const v = new THREE.Vector3();
        for (const [code, g] of rt.groups) {
          g.updateWorldMatrix(true, false);
          g.getWorldPosition(v);
          out[code] = { x: v.x, y: v.y - (rt.lift.get(code) ?? 0), z: v.z };
        }
        return out;
      },
      labels() {
        return [...rt.labels.entries()].map(([code, slot]) => {
          const r = slot.pill.getBoundingClientRect();
          const visible = slot.shown && getComputedStyle(slot.button).visibility !== "hidden";
          return { code, visible, rect: { x: r.x, y: r.y, width: r.width, height: r.height } };
        });
      },
      camera() {
        const t = rt.camera.target;
        return {
          position: { x: camera.position.x, y: camera.position.y, z: camera.position.z },
          target: { ...t },
          fov: camera.fov,
          pitch: livePitch(camera, t),
        };
      },
      info() {
        return { ...rt.stats };
      },
    };
    window.__pytScene = hook;
    return () => {
      if (window.__pytScene === hook) delete window.__pytScene;
    };
  }, [rt, camera]);
  return null;
}

/** Keeps the store's reduced-motion flag honest for the scene's own decisions. */
export function useSceneReducedMotion(prefers: boolean): boolean {
  const fromStore = useRoom((s) => s.reducedMotion);
  return fromStore || prefers;
}
