"use client";

import { CameraControls } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import type CameraControlsImpl from "camera-controls";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type * as THREE from "three";
import { useRoom } from "@/lib/room/store";
import type { Venue } from "@/lib/venue/schema";
import { CameraDirector } from "./cameraDirector";
import { pitchOf } from "./cameraMath";
import { useRuntime } from "./runtime";

/**
 * Orbit with damping (camera-controls), clamped to 25-70 degrees of pitch, a distance
 * range and the site bounds. Intent moves (overview, frame, sit) are exact 520 ms
 * ease-in-out tweens run by the director, not open-ended damping; with reduced
 * motion they cut. A resize recomputes the current intent.
 */
export function CameraRig({ venue, reducedMotion }: { venue: Venue; reducedMotion: boolean }) {
  const controls = useRef<CameraControlsImpl>(null);
  const get = useThree((s) => s.get);
  const width = useThree((s) => s.size.width);
  const height = useThree((s) => s.size.height);
  const rt = useRuntime();
  const [director] = useState(() => new CameraDirector());

  useLayoutEffect(() => {
    const c = controls.current;
    if (!c) return;
    const camera = get().camera as THREE.PerspectiveCamera;
    director.attach({ venue, camera, controls: c, size: { width, height }, rt, reducedMotion });
    director.go(useRoom.getState().camera, true);
  }, [director, get, venue, width, height, rt, reducedMotion]);

  useEffect(
    () =>
      useRoom.subscribe((s, prev) => {
        if (s.camera.id !== prev.camera.id) director.go(s.camera, false);
        // The card's height settles after it opens: frame the table again above it.
        else if (s.frameInset !== prev.frameInset && s.camera.kind === "frame") director.go(s.camera, false);
      }),
    [director],
  );

  useFrame(() => {
    director.step(performance.now());
  }, -2);
  useFrame(() => director.track(), -0.5);

  return (
    <CameraControls
      ref={controls}
      makeDefault
      smoothTime={0.22}
      draggingSmoothTime={0.1}
      dollySpeed={0.6}
      truckSpeed={1.4}
      dollyToCursor
      restThreshold={0.005}
    />
  );
}

/** Pitch of the live camera for the test hook: degrees the view looks down from horizontal. */
export function livePitch(camera: THREE.Camera, target: { x: number; y: number; z: number }): number {
  return pitchOf({ x: camera.position.x, y: camera.position.y, z: camera.position.z }, target);
}
