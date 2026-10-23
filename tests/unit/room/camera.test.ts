import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  bearingOf,
  clampPitch,
  defaultPose,
  distanceLimits,
  distanceOf,
  easeInOut,
  framePose,
  frameRegion,
  interpolatePose,
  MOVE_MS,
  ORBIT_FOV,
  PITCH_MAX,
  PITCH_MIN,
  pitchOf,
  polarLimits,
  projectAll,
  sitePoints,
  SIT_FRAME_REACH,
  sitPitch,
  sitPose,
} from "@/components/room/scene3d/cameraMath";
import { planOrientation } from "@/lib/room/orientation";
import { EYE_HEIGHT, deg, seatView, verticalFovForAspect } from "@/lib/venue/geometry";
import { parseVenue } from "@/lib/venue/load";

const venues = ["halcyon", "orchard-room"].map((id) => parseVenue(readFileSync(`venues/${id}/venue.json`, "utf8"), id));
const ASPECTS = [390 / 844, 0.62, 0.8, 1, 1440 / 900, 2.2];

describe("pitch clamps", () => {
  it("clamps the orbit to 25-70 degrees above horizontal", () => {
    expect(PITCH_MIN).toBe(25);
    expect(PITCH_MAX).toBe(70);
    expect(clampPitch(10)).toBe(25);
    expect(clampPitch(89)).toBe(70);
    expect(clampPitch(48)).toBe(48);
    const p = polarLimits();
    expect(90 - deg(p.max)).toBeCloseTo(25, 9);
    expect(90 - deg(p.min)).toBeCloseTo(70, 9);
  });
});

describe.each(venues.map((v) => [v.id, v] as const))("default camera in %s", (_id, venue) => {
  it.each(ASPECTS)("looks toward planOrientation at aspect %f, at 35 degrees, framing the whole site", (aspect) => {
    const pose = defaultPose(venue, aspect);
    expect(pose.fov).toBe(ORBIT_FOV);
    expect(pose.bearing).toBe(planOrientation(venue, aspect));
    const look = bearingOf(pose.position, pose.target);
    const diff = ((look - planOrientation(venue, aspect) + 540) % 360) - 180;
    expect(Math.abs(diff)).toBeLessThan(1e-6);
    const pitch = pitchOf(pose.position, pose.target);
    expect(pitch).toBeGreaterThanOrEqual(PITCH_MIN);
    expect(pitch).toBeLessThanOrEqual(PITCH_MAX);
    for (const p of projectAll(sitePoints(venue), pose.position, pose.target, pose.fov, aspect)) {
      expect(Math.abs(p.x)).toBeLessThanOrEqual(1);
      expect(Math.abs(p.y)).toBeLessThanOrEqual(1);
    }
    const limits = distanceLimits(venue, aspect);
    expect(distanceOf(pose.position, pose.target)).toBeLessThanOrEqual(limits.max);
  });

  it("portrait looks along the room with the view on the right", () => {
    const portrait = defaultPose(venue, 390 / 844).bearing;
    const landscape = defaultPose(venue, 1.6).bearing;
    expect((landscape - portrait + 360) % 360).toBe(90);
  });
});

describe("Sit here", () => {
  it.each(venues.flatMap((v) => v.tables.map((t) => [v.id, t.id, t] as const)))(
    "%s %s puts the eye at 1.15 m, facing the view, 26 mm",
    (_v, _c, t) => {
      for (const aspect of [390 / 844, 1.5, 1.6]) {
        const pose = sitPose(t, aspect);
        const v = seatView(t);
        expect(pose.position.y).toBe(EYE_HEIGHT);
        expect(pose.position).toEqual(v.position);
        expect(pose.fov).toBeCloseTo(verticalFovForAspect(aspect), 9);
        const d = distanceOf(pose.position, pose.target);
        const dx = (pose.target.x - pose.position.x) / d;
        const dy = (pose.target.y - pose.position.y) / d;
        const dz = (pose.target.z - pose.position.z) / d;
        // The yaw is the table's view exactly.
        const flat = Math.hypot(v.direction.x, v.direction.z);
        expect(dx / Math.hypot(dx, dz)).toBeCloseTo(v.direction.x / flat, 9);
        expect(dz / Math.hypot(dx, dz)).toBeCloseTo(v.direction.z / flat, 9);
        // The pitch is the authored one, or lower so the frame reaches the place setting.
        const pitch = (Math.asin(dy) * 180) / Math.PI;
        expect(pitch).toBeCloseTo(sitPitch(v.pitch, aspect), 9);
        expect(pitch).toBeLessThanOrEqual(v.pitch + 1e-9);
        expect(pitch - pose.fov / 2).toBeLessThanOrEqual(-SIT_FRAME_REACH + 1e-9);
      }
    },
  );

  it.each(venues.flatMap((v) => v.tables.map((t) => [v.id, t.id, t] as const)))(
    "%s %s renders on the authored view exactly",
    (_v, _c, t) => {
      const pose = sitPose(t, 1.5, { authoredPitch: true });
      const v = seatView(t);
      const d = distanceOf(pose.position, pose.target);
      expect((pose.target.x - pose.position.x) / d).toBeCloseTo(v.direction.x, 9);
      expect((pose.target.y - pose.position.y) / d).toBeCloseTo(v.direction.y, 9);
      expect((pose.target.z - pose.position.z) / d).toBeCloseTo(v.direction.z, 9);
    },
  );

  it("keeps the authored view on a phone and tips down only as far as needed on a wide screen", () => {
    expect(sitPitch(-4, 390 / 844)).toBe(-4);
    const wide = sitPitch(-4, 1.6);
    expect(wide).toBeLessThan(-4);
    expect(wide).toBeCloseTo(verticalFovForAspect(1.6) / 2 - SIT_FRAME_REACH, 9);
  });
});

describe("frame", () => {
  it.each(ASPECTS)("keeps the table in the clear part of the screen at aspect %f", (aspect) => {
    const venue = venues[0]!;
    for (const t of venue.tables) {
      const pose = framePose(t, aspect, 0, 50);
      expect(pose.target.x).toBe(t.x);
      expect(pose.target.z).toBe(t.z);
      const region = frameRegion(aspect);
      const top = 1 - 2 * region.top;
      const bottom = -1 + 2 * region.bottom;
      // The pivot lands in the middle of the clear band, above the card on phones.
      expect(pose.screenY).toBeCloseTo((top + bottom) / 2, 9);
      expect(aspect >= 0.8 || pose.screenY > 0.2).toBe(true);
      const pitch = pitchOf(pose.position, pose.target);
      expect(pitch).toBeGreaterThanOrEqual(PITCH_MIN);
      expect(pitch).toBeLessThanOrEqual(PITCH_MAX);
    }
  });
});

describe("moves", () => {
  it("are 400 to 600 ms, eased in and out", () => {
    expect(MOVE_MS).toBeGreaterThanOrEqual(400);
    expect(MOVE_MS).toBeLessThanOrEqual(600);
    expect(easeInOut(0)).toBe(0);
    expect(easeInOut(1)).toBe(1);
    expect(easeInOut(0.5)).toBeCloseTo(0.5, 9);
    expect(easeInOut(0.1)).toBeLessThan(0.1);
    expect(easeInOut(0.9)).toBeGreaterThan(0.9);
  });

  it("start and end exactly on their poses", () => {
    const venue = venues[0]!;
    const a = defaultPose(venue, 1.6);
    const b = framePose(venue.tables[0]!, 1.6, a.bearing, a.pitch);
    for (const mode of ["orbit", "direct"] as const) {
      const start = interpolatePose(a, b, 0, mode);
      const end = interpolatePose(a, b, 1, mode);
      expect(distanceOf(start.position, a.position)).toBeLessThan(1e-6);
      expect(distanceOf(end.position, b.position)).toBeLessThan(1e-6);
      expect(end.fov).toBe(b.fov);
    }
  });
});
