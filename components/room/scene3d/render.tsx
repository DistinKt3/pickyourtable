"use client";

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Suspense, useEffect, useLayoutEffect, useMemo, useState } from "react";
import * as THREE from "three";
import { useRoom } from "@/lib/room/store";
import type { RoomData } from "@/lib/room/types";
import { SEAT_VIEW_ASPECT, seatViewFov } from "@/lib/venue/geometry";
import { sitPose } from "./cameraMath";
import { ContactShadows } from "./ContactShadows";
import { Effects } from "./Effects";
import { tablePlacements } from "./layout";
import { Lights } from "./Lights";
import { createFadeUniforms, createSharedUniforms } from "./materials";
import { RENDER } from "./palette";
import { createRuntime, patchRuntime, RuntimeContext, useRuntime } from "./runtime";
import { Shell } from "./Shell";
import { Tables } from "./Tables";

/**
 * The view from a table's main seat, rendered at build time (PRD "View from the
 * seat"): eye at 1.15 m facing the table's view, the 26 mm lens at 3:2, full-height
 * walls and ceiling, glass, water and sky beyond, a warm interior, and more of
 * everything than the live scene (supersampled, more AO samples, softer shadows).
 * Sets `window.__renderReady` once the final frame is on screen.
 */

declare global {
  interface Window {
    __renderReady?: boolean;
  }
}

function placeCamera(camera: THREE.PerspectiveCamera, data: RoomData, code: string) {
  const table = data.venue.tables.find((t) => t.id === code);
  if (!table) return;
  const pose = sitPose(table, SEAT_VIEW_ASPECT);
  camera.position.set(pose.position.x, pose.position.y, pose.position.z);
  camera.lookAt(pose.target.x, pose.target.y, pose.target.z);
  camera.fov = seatViewFov.vertical;
  // Nearest thing in frame is the place setting, farthest the sea: keep the depth range tight.
  camera.near = 0.12;
  camera.far = 3000;
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld();
}

function setupRenderer(gl: THREE.WebGLRenderer) {
  gl.shadowMap.autoUpdate = false;
  gl.shadowMap.needsUpdate = true;
  gl.setClearColor(0x000000, 0);
}

function startCounting(state: { frames: number }) {
  state.frames = 0;
}

function finish(state: { frames: number }): "more" | "done" | "idle" {
  if (state.frames < 0) return "idle";
  state.frames += 1;
  if (state.frames < 4) return "more";
  if (state.frames === 4) return "done";
  return "idle";
}

function RenderScene({ data, code }: { data: RoomData; code: string }) {
  const rt = useRuntime();
  const get = useThree((s) => s.get);
  const invalidate = useThree((s) => s.invalidate);
  const placements = useMemo(() => tablePlacements(data.venue), [data.venue]);
  const shared = useMemo(() => createSharedUniforms(), []);
  const fade = useMemo(() => createFadeUniforms(), []);
  const [counter] = useState(() => ({ frames: -1 }));

  useLayoutEffect(() => {
    patchRuntime(rt, { invalidate, sit: 1 });
    const { gl, camera } = get();
    setupRenderer(gl);
    placeCamera(camera as THREE.PerspectiveCamera, data, code);
  }, [rt, invalidate, get, data, code]);

  useEffect(() => {
    let cancelled = false;
    const { gl, scene, camera } = get();
    const run = async () => {
      try {
        await gl.compileAsync(scene, camera);
      } catch {
        // The first frame compiles anyway.
      }
      if (cancelled) return;
      startCounting(counter);
      invalidate();
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [get, invalidate, counter]);

  useFrame((state) => {
    const step = finish(counter);
    if (step === "more") state.invalidate();
    if (step === "done") requestAnimationFrame(() => (window.__renderReady = true));
  }, 200);

  return (
    <>
      <Lights venue={data.venue} palette={RENDER} shadowMapSize={4096} render />
      <Suspense fallback={null}>
        <Shell venue={data.venue} palette={RENDER} shared={shared} fade={fade} modelUrl={data.modelUrl} />
        <Tables
          data={data}
          placements={placements}
          palette={RENDER}
          shared={shared}
          reducedMotion
          onShadowsChanged={invalidate}
        />
        <ContactShadows venue={data.venue} version="render" opacity={RENDER.contactShadow} resolution={4096} blur={1.2} />
      </Suspense>
      <Effects
        background={RENDER.background}
        quality={2}
        aoIntensity={RENDER.ao.intensity * 0.9}
        aoColor={RENDER.ao.color}
        render
      />
    </>
  );
}

export default function SeatRender({ data, code }: { data: RoomData; code: string }) {
  const [rt] = useState(createRuntime);
  // Seated: rings, ghosts and lifts are off, as they are for "Sit here".
  useState(() => {
    useRoom.getState().sit(code);
    return true;
  });
  return (
    <RuntimeContext value={rt}>
      <div className="fixed inset-0 bg-[#e9ece8]">
        <Canvas
          frameloop="demand"
          dpr={typeof window === "undefined" ? 1 : Math.min(2, window.devicePixelRatio || 1)}
          shadows={{ enabled: true, type: THREE.PCFShadowMap, autoUpdate: false }}
          gl={{ antialias: false, alpha: false, stencil: false, preserveDrawingBuffer: true }}
          camera={{ fov: seatViewFov.vertical, near: 0.04, far: 6000 }}
          style={{ position: "absolute", inset: 0 }}
          data-seat-render={code}
        >
          <RuntimeContext value={rt}>
            <RenderScene data={data} code={code} />
          </RuntimeContext>
        </Canvas>
      </div>
    </RuntimeContext>
  );
}
