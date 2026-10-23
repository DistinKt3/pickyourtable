"use client";

import { PerformanceMonitor } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
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
import { measureLabel, patchRuntime, type Runtime, useRuntime } from "./runtime";
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

/** Renderer settings the scene relies on: shadows refresh on demand, the clear is transparent. */
function setupRenderer(gl: THREE.WebGLRenderer) {
  gl.shadowMap.autoUpdate = false;
  gl.shadowMap.needsUpdate = true;
  gl.setClearColor(0x000000, 0);
}

function refreshShadows(gl: THREE.WebGLRenderer) {
  gl.shadowMap.needsUpdate = true;
}

export function Scene({ data, palette, background, reducedMotion, onReady }: SceneProps) {
  const rt = useRuntime();
  const get = useThree((s) => s.get);
  const invalidate = useThree((s) => s.invalidate);
  const setDpr = useThree((s) => s.setDpr);
  const placements = useMemo(() => tablePlacements(data.venue), [data.venue]);
  const shared = useMemo(() => createSharedUniforms(), []);
  const fade = useMemo(() => createFadeUniforms(), []);
  const [quality, setQuality] = useState<Quality>(2);
  const [ghostVersion, setGhostVersion] = useState(0);

  useLayoutEffect(() => {
    patchRuntime(rt, { invalidate });
    setupRenderer(get().gl);
  }, [rt, invalidate, get]);

  useEffect(() => {
    setDpr(Math.min(window.devicePixelRatio || 1, DPR[quality]));
  }, [quality, setDpr]);

  const onShadowsChanged = useCallback(() => {
    refreshShadows(get().gl);
    setGhostVersion((v) => v + 1);
  }, [get]);

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
          version={`${palette.theme}:${ghostVersion}:${data.modelUrl ?? ""}`}
          opacity={palette.contactShadow}
          resolution={quality === 0 ? 1024 : 2048}
        />
        <LabelProjector data={data} />
        <Ready onReady={onReady} />
      </Suspense>
      <Effects
        background={background}
        look={palette.post}
        quality={quality}
        aoIntensity={palette.ao.intensity}
        aoColor={palette.ao.color}
      />
      <Stats />
    </>
  );
}

function captureStats(rt: Runtime, gl: THREE.WebGLRenderer) {
  rt.stats = { drawCalls: gl.info.render.calls, triangles: gl.info.render.triangles };
}

function setInfoAutoReset(gl: THREE.WebGLRenderer, on: boolean) {
  gl.info.autoReset = on;
}

/** Snapshot of renderer.info for the whole frame, including the post passes. */
function Stats() {
  const get = useThree((s) => s.get);
  const rt = useRuntime();
  useEffect(() => {
    const { gl } = get();
    setInfoAutoReset(gl, false);
    return () => setInfoAutoReset(gl, true);
  }, [get]);
  useFrame((state) => state.gl.info.reset(), -100);
  useFrame((state) => captureStats(rt, state.gl), 100);
  return null;
}

function markReady(rt: Runtime) {
  rt.ready = true;
  if (window.__pytScene) window.__pytScene.ready = true;
}

/**
 * Compiles every program up front, waits for two complete frames, then reports
 * ready: the first frame the lead cross-fades in is final, with no shader hitch.
 */
function Ready({ onReady }: { onReady?: () => void }) {
  const get = useThree((s) => s.get);
  const invalidate = useThree((s) => s.invalidate);
  const rt = useRuntime();
  const [phase] = useState(() => ({ frames: -1, done: false }));
  const callback = useRef(onReady);
  useEffect(() => {
    callback.current = onReady;
  }, [onReady]);

  useEffect(() => {
    let cancelled = false;
    const { gl, scene, camera } = get();
    const compile = async () => {
      try {
        await gl.compileAsync(scene, camera);
      } catch {
        // Compiling up front is an optimization; the first frame compiles anyway.
      }
      // Labels are measured in the page font; a late font swap would resize every pill
      // after the cross-fade, so wait for it and measure again.
      await document.fonts.ready;
      if (cancelled) return;
      for (const slot of rt.labels.values()) measureLabel(rt, slot);
      startCounting(phase);
      invalidate();
    };
    void compile();
    return () => {
      cancelled = true;
    };
  }, [get, invalidate, phase, rt]);

  useFrame((state) => {
    const step = countFrame(phase);
    if (step === "more") state.invalidate();
    else if (step === "now") {
      markReady(rt);
      callback.current?.();
    }
  }, 200);
  return null;
}

function startCounting(phase: { frames: number; done: boolean }) {
  phase.frames = 0;
}

/** "more" until three frames have rendered after compiling, then "now" once, then "idle". */
function countFrame(phase: { frames: number; done: boolean }): "more" | "now" | "idle" {
  if (phase.done || phase.frames < 0) return "idle";
  phase.frames += 1;
  if (phase.frames < 3) return "more";
  phase.done = true;
  return "now";
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
