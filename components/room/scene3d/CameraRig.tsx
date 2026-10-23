"use client";

import { CameraControls } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import type CameraControlsImpl from "camera-controls";
import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import * as THREE from "three";
import { type CameraIntent, useRoom } from "@/lib/room/store";
import type { Venue } from "@/lib/venue/schema";
import {
  bearingOf,
  defaultPose,
  distanceLimits,
  distanceOf,
  framePose,
  interpolatePose,
  MOVE_MS,
  pitchOf,
  polarLimits,
  type Pose,
  sitPose,
  targetBounds,
} from "./cameraMath";
import { useRuntime } from "./runtime";

/**
 * Orbit with damping (camera-controls), clamped to 25-70 degrees of pitch, a distance
 * range and the site bounds. Intent moves (overview, frame, sit) are exact 520 ms
 * ease-in-out tweens driven here, not open-ended damping; with reduced motion they cut.
 */

interface Move {
  from: Pose;
  to: Pose;
  start: number;
  mode: "orbit" | "direct";
  sitFrom: number;
  sitTo: number;
}

const NEAR_ORBIT = 0.5;
const NEAR_SEAT = 0.04;
const FAR_ORBIT = 2500;
const FAR_SEAT = 6000;

export function CameraRig({ venue, reducedMotion }: { venue: Venue; reducedMotion: boolean }) {
  const controls = useRef<CameraControlsImpl>(null);
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const size = useThree((s) => s.size);
  const invalidate = useThree((s) => s.invalidate);
  const rt = useRuntime();
  const move = useRef<Move | null>(null);
  const intent = useRef<CameraIntent>(useRoom.getState().camera);
  const screenY = useRef(0);
  const aspect = size.width / Math.max(1, size.height);

  const current = useCallback((): Pose => {
    const c = controls.current;
    const t = new THREE.Vector3();
    c?.getTarget(t);
    return {
      position: { x: camera.position.x, y: camera.position.y, z: camera.position.z },
      target: { x: t.x, y: t.y, z: t.z },
      fov: camera.fov,
      screenY: screenY.current,
    };
  }, [camera]);

  const constrain = useCallback(
    (orbit: boolean) => {
      const c = controls.current;
      if (!c) return;
      if (orbit) {
        const polar = polarLimits();
        const dist = distanceLimits(venue, aspect);
        const b = targetBounds(venue);
        c.minPolarAngle = polar.min;
        c.maxPolarAngle = polar.max;
        c.minDistance = dist.min;
        c.maxDistance = dist.max;
        c.setBoundary(new THREE.Box3(new THREE.Vector3(b.min.x, b.min.y, b.min.z), new THREE.Vector3(b.max.x, b.max.y, b.max.z)));
        rt.overviewDistance = dist.max / 1.3;
      } else {
        c.minPolarAngle = 0;
        c.maxPolarAngle = Math.PI;
        c.minDistance = 0.01;
        c.maxDistance = Infinity;
        c.setBoundary();
      }
    },
    [venue, aspect, rt],
  );

  const apply = useCallback(
    (pose: Pose, sit: number) => {
      const c = controls.current;
      if (!c) return;
      c.setLookAt(pose.position.x, pose.position.y, pose.position.z, pose.target.x, pose.target.y, pose.target.z, false);
      camera.fov = pose.fov;
      camera.near = NEAR_ORBIT + (NEAR_SEAT - NEAR_ORBIT) * Math.min(1, sit * 1.4);
      camera.far = FAR_ORBIT + (FAR_SEAT - FAR_ORBIT) * sit;
      screenY.current = pose.screenY;
      const h = size.height;
      if (Math.abs(pose.screenY) > 1e-4) camera.setViewOffset(size.width, h, 0, (pose.screenY * h) / 2, size.width, h);
      else camera.clearViewOffset();
      camera.updateProjectionMatrix();
      rt.sit = sit;
      rt.camera.target = { ...pose.target };
    },
    [camera, size, rt],
  );

  const poseFor = useCallback(
    (i: CameraIntent): Pose => {
      const tables = venue.tables;
      if (i.kind === "sit") {
        const t = tables.find((x) => x.id === i.code);
        if (t) return sitPose(t, aspect);
      }
      if (i.kind === "frame") {
        const t = tables.find((x) => x.id === i.code);
        if (t) {
          const now = current();
          const fromSeat = rt.sit > 0.5;
          const d = defaultPose(venue, aspect);
          const b = fromSeat ? d.bearing : bearingOf(now.position, now.target);
          const p = fromSeat ? d.pitch : pitchOf(now.position, now.target);
          return framePose(t, aspect, b, p);
        }
      }
      return defaultPose(venue, aspect);
    },
    [venue, aspect, current, rt],
  );

  const go = useCallback(
    (i: CameraIntent, cut: boolean) => {
      intent.current = i;
      const to = poseFor(i);
      const sitTo = i.kind === "sit" ? 1 : 0;
      const c = controls.current;
      if (!c) return;
      if (cut || reducedMotion) {
        move.current = null;
        constrain(sitTo === 0);
        if (sitTo) constrain(false);
        apply(to, sitTo);
        c.enabled = sitTo === 0;
        invalidate();
        return;
      }
      const from = current();
      constrain(false);
      c.enabled = false;
      move.current = {
        from,
        to,
        start: performance.now(),
        mode: sitTo || rt.sit > 0.01 ? "direct" : "orbit",
        sitFrom: rt.sit,
        sitTo,
      };
      invalidate();
    },
    [poseFor, reducedMotion, constrain, apply, invalidate, current, rt],
  );

  // First frame: wherever the store says, as a cut.
  useLayoutEffect(() => {
    go(useRoom.getState().camera, true);
    // Only on mount and when the room changes size: a resize recomputes the current intent.
  }, [go]);

  useEffect(
    () =>
      useRoom.subscribe((s, prev) => {
        if (s.camera.id !== prev.camera.id) go(s.camera, false);
      }),
    [go],
  );

  useFrame(() => {
    const m = move.current;
    if (!m) return;
    const t = Math.min(1, (performance.now() - m.start) / MOVE_MS);
    const pose = interpolatePose(m.from, m.to, t, m.mode);
    const k = m.sitFrom + (m.sitTo - m.sitFrom) * (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
    apply(pose, k);
    if (t >= 1) {
      move.current = null;
      apply(m.to, m.sitTo);
      if (m.sitTo === 0) {
        constrain(true);
        if (controls.current) controls.current.enabled = true;
      }
    }
    invalidate();
  }, -2);

  useFrame(() => {
    const c = controls.current;
    if (!c) return;
    const t = new THREE.Vector3();
    c.getTarget(t);
    rt.camera.target = { x: t.x, y: t.y, z: t.z };
  }, -0.5);

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

export { distanceOf };
