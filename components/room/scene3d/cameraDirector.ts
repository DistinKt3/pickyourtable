import type CameraControlsImpl from "camera-controls";
import * as THREE from "three";
import type { CameraIntent } from "@/lib/room/store";
import type { Venue } from "@/lib/venue/schema";
import {
  bearingOf,
  defaultPose,
  distanceLimits,
  framePose,
  interpolatePose,
  MOVE_MS,
  pitchOf,
  polarLimits,
  type Pose,
  sitPose,
  targetBounds,
} from "./cameraMath";
import type { Runtime } from "./runtime";

/**
 * Drives the camera: orbit constraints for the diorama, free placement for seats, and
 * exact-length eased moves between intents. Plain imperative code that owns the
 * three.js camera and the camera-controls instance; the React rig only feeds it.
 */

const NEAR_ORBIT = 0.5;
const NEAR_SEAT = 0.04;
const FAR_ORBIT = 2500;
const FAR_SEAT = 6000;

interface Move {
  from: Pose;
  to: Pose;
  start: number;
  mode: "orbit" | "direct";
  sitFrom: number;
  sitTo: number;
}

export interface DirectorContext {
  venue: Venue;
  camera: THREE.PerspectiveCamera;
  controls: CameraControlsImpl;
  size: { width: number; height: number };
  rt: Runtime;
  reducedMotion: boolean;
}

export class CameraDirector {
  private ctx: DirectorContext | null = null;
  private move: Move | null = null;
  private screenY = 0;
  /** False until the first pose is applied: before that the camera is R3F's placeholder. */
  private placed = false;
  private readonly tmp = new THREE.Vector3();

  attach(ctx: DirectorContext): void {
    this.ctx = ctx;
  }

  get moving(): boolean {
    return this.move !== null;
  }

  private aspect(): number {
    const c = this.ctx!;
    return c.size.width / Math.max(1, c.size.height);
  }

  current(): Pose {
    const { camera, controls } = this.ctx!;
    controls.getTarget(this.tmp);
    return {
      position: { x: camera.position.x, y: camera.position.y, z: camera.position.z },
      target: { x: this.tmp.x, y: this.tmp.y, z: this.tmp.z },
      fov: camera.fov,
      screenY: this.screenY,
    };
  }

  constrain(orbit: boolean): void {
    const { controls: c, venue, rt } = this.ctx!;
    if (orbit) {
      const polar = polarLimits();
      const dist = distanceLimits(venue, this.aspect());
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
  }

  apply(pose: Pose, sit: number): void {
    const { camera, controls, size, rt } = this.ctx!;
    void controls.setLookAt(
      pose.position.x,
      pose.position.y,
      pose.position.z,
      pose.target.x,
      pose.target.y,
      pose.target.z,
      false,
    );
    camera.fov = pose.fov;
    camera.near = NEAR_ORBIT + (NEAR_SEAT - NEAR_ORBIT) * Math.min(1, sit * 1.4);
    camera.far = FAR_ORBIT + (FAR_SEAT - FAR_ORBIT) * sit;
    this.screenY = pose.screenY;
    if (Math.abs(pose.screenY) > 1e-4)
      camera.setViewOffset(size.width, size.height, 0, (pose.screenY * size.height) / 2, size.width, size.height);
    else camera.clearViewOffset();
    camera.updateProjectionMatrix();
    rt.sit = sit;
    rt.camera.target = { ...pose.target };
  }

  poseFor(i: CameraIntent): Pose {
    const { venue, rt } = this.ctx!;
    const aspect = this.aspect();
    if (i.kind === "sit") {
      const t = venue.tables.find((x) => x.id === i.code);
      if (t) return sitPose(t, aspect);
    }
    if (i.kind === "frame") {
      const t = venue.tables.find((x) => x.id === i.code);
      if (t) {
        const now = this.current();
        // From a seat or before the first pose, frame from the default bearing and pitch.
        const fromSeat = rt.sit > 0.5 || !this.placed;
        const d = defaultPose(venue, aspect);
        const b = fromSeat ? d.bearing : bearingOf(now.position, now.target);
        const p = fromSeat ? d.pitch : pitchOf(now.position, now.target);
        return framePose(t, aspect, b, p);
      }
    }
    return defaultPose(venue, aspect);
  }

  /** Starts a move to an intent, or cuts there (first frame, resize, reduced motion). */
  go(i: CameraIntent, cut: boolean): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const to = this.poseFor(i);
    const sitTo = i.kind === "sit" ? 1 : 0;
    if (cut || ctx.reducedMotion) {
      this.move = null;
      this.constrain(sitTo === 0);
      this.apply(to, sitTo);
      this.placed = true;
      ctx.controls.enabled = sitTo === 0;
      ctx.rt.invalidate();
      return;
    }
    const from = this.current();
    this.constrain(false);
    ctx.controls.enabled = false;
    const mode = sitTo || ctx.rt.sit > 0.01 ? "direct" : "orbit";
    this.move = { from, to, start: performance.now(), mode, sitFrom: ctx.rt.sit, sitTo };
    ctx.rt.invalidate();
  }

  /** Advances a running move; true while it still needs frames. */
  step(now: number): boolean {
    const m = this.move;
    const ctx = this.ctx;
    if (!m || !ctx) return false;
    const t = Math.min(1, (now - m.start) / MOVE_MS);
    const k = t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
    this.apply(interpolatePose(m.from, m.to, t, m.mode), m.sitFrom + (m.sitTo - m.sitFrom) * k);
    if (t >= 1) {
      this.move = null;
      this.apply(m.to, m.sitTo);
      if (m.sitTo === 0) {
        this.constrain(true);
        ctx.controls.enabled = true;
      }
    }
    ctx.rt.invalidate();
    return this.move !== null;
  }

  /** Keeps the runtime's view of the orbit target current while the guest orbits. */
  track(): void {
    const ctx = this.ctx;
    if (!ctx || this.move) return;
    ctx.controls.getTarget(this.tmp);
    ctx.rt.camera.target = { x: this.tmp.x, y: this.tmp.y, z: this.tmp.z };
  }
}
