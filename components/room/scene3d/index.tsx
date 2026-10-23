"use client";

import { Canvas } from "@react-three/fiber";
import { useMemo, useState } from "react";
import * as THREE from "three";
import { cx } from "@/lib/format";
import { useRoom } from "@/lib/room/store";
import type { RoomData } from "@/lib/room/types";
import { LabelLayer } from "./Labels";
import { paletteFor } from "./palette";
import { createRuntime, readSurfaceColor, RuntimeContext, usePrefersReducedMotion, useTheme } from "./runtime";
import { Scene, TestHook, useSceneReducedMotion } from "./Scene";

/**
 * The 3D room: a living architectural diorama of the venue, built from venue.json.
 * The lead mounts it with `next/dynamic(..., { ssr: false })` after the 2D plan has
 * painted and cross-fades it in once `onReady` fires. It fills its container and
 * fades into the page color at its edges.
 *
 * Reads `availability`, `hovered`, `selected`, `sitting`, `camera`, `reducedMotion`
 * and `slot` from the room store; calls only `hover` and `select`.
 */
export default function RoomScene3D({ data, onReady, className }: { data: RoomData; onReady?: () => void; className?: string }) {
  const theme = useTheme();
  const palette = paletteFor(theme);
  const background = useMemo(() => readSurfaceColor(palette.background), [palette.background]);
  const prefersReduced = usePrefersReducedMotion();
  const reducedMotion = useSceneReducedMotion(prefersReduced);
  const [rt] = useState(createRuntime);
  const sitting = useRoom((s) => s.sitting);

  return (
    <RuntimeContext value={rt}>
      <div className={cx("absolute inset-0 overflow-hidden select-none", className)} style={{ background }}>
        <Canvas
          frameloop="demand"
          dpr={[1, 2]}
          shadows={{ enabled: true, type: THREE.PCFShadowMap, autoUpdate: false }}
          gl={{ antialias: false, alpha: false, stencil: false, powerPreference: "high-performance" }}
          camera={{ fov: 35, near: 0.5, far: 2500, position: [0, 40, 40] }}
          style={{ position: "absolute", inset: 0, touchAction: "none" }}
          onPointerMissed={(e) => {
            if (e.type !== "click") return;
            const s = useRoom.getState();
            if (s.selected && !s.sitting) s.select(null);
          }}
        >
          <RuntimeContext value={rt}>
            <Scene data={data} palette={palette} background={background} reducedMotion={reducedMotion} onReady={onReady} />
            <TestHook />
          </RuntimeContext>
        </Canvas>
        <LabelLayer data={data} theme={theme} rt={rt} hidden={sitting != null} />
      </div>
    </RuntimeContext>
  );
}
