import { describe, expect, it } from "vitest";
import { parseTransform, planFrame, project, rotatePoint, tableShape, wallShapes } from "@/components/room/plan2d/layout";
import { planOrientation, viewSide } from "@/lib/room/orientation";
import { ring } from "@/lib/venue/geometry";
import { listVenueIds, loadVenue } from "@/lib/venue/load";

describe("2D plan layout truth", () => {
  it("draws every table exactly where venue.json puts it", async () => {
    for (const id of await listVenueIds()) {
      const v = await loadVenue(id);
      for (const t of v.tables) {
        const shape = tableShape(t);
        const p = parseTransform(shape.transform);
        expect(p, t.id).not.toBeNull();
        expect(p!.x).toBeCloseTo(t.x, 3);
        expect(p!.z).toBeCloseTo(t.z, 3);
        expect(p!.rotation).toBeCloseTo(t.rotation, 3);
        expect(shape.ring).toEqual(ring(t));
      }
    }
  });

  it("orients toward the view in landscape and puts the view on the right in portrait", async () => {
    const halcyon = await loadVenue("halcyon");
    const orchard = await loadVenue("orchard-room");
    expect(viewSide(halcyon)).toBe("north");
    expect(viewSide(orchard)).toBe("south");
    expect(planOrientation(halcyon, 1.6)).toBe(0);
    expect(planOrientation(halcyon, 0.46)).toBe(270);
    expect(planOrientation(orchard, 1.6)).toBe(180);
    expect(planOrientation(orchard, 0.46)).toBe(90);
  });

  it("projects the screen-up bearing to the top of the plan", async () => {
    const v = await loadVenue("halcyon");
    for (const bearing of [0, 90, 180, 270]) {
      const frame = planFrame(v, bearing);
      // A point 5 m in the screen-up direction from the room center must be higher on screen.
      const c = { x: v.room.width / 2, z: v.room.depth / 2 };
      const b = (bearing * Math.PI) / 180;
      const ahead = { x: c.x + Math.sin(b) * 5, z: c.z - Math.cos(b) * 5 };
      const pc = project(frame, c);
      const pa = project(frame, ahead);
      expect(pa.top).toBeLessThan(pc.top);
      expect(Math.abs(pa.left - pc.left)).toBeLessThan(0.01);
    }
  });

  it("keeps every table inside the plan in both orientations", async () => {
    for (const id of await listVenueIds()) {
      const v = await loadVenue(id);
      for (const aspect of [1.6, 0.46]) {
        const frame = planFrame(v, planOrientation(v, aspect));
        for (const t of v.tables) {
          const p = project(frame, { x: t.x, z: t.z });
          expect(p.left).toBeGreaterThan(0);
          expect(p.left).toBeLessThan(100);
          expect(p.top).toBeGreaterThan(0);
          expect(p.top).toBeLessThan(100);
        }
      }
    }
  });

  it("rotation keeps distances", () => {
    const a = rotatePoint({ x: 3, z: 4 }, 37);
    expect(Math.hypot(a.x, a.y)).toBeCloseTo(5, 6);
  });

  it("draws glass walls with mullions and solid walls outside the room", async () => {
    const v = await loadVenue("halcyon");
    const walls = wallShapes(v);
    const glass = walls.find((w) => w.id === "north-glass")!;
    expect(glass.ticks.length).toBeGreaterThan(4);
    // The north wall sits outside the room: z below 0.
    expect(glass.z1).toBeLessThan(0);
    const east = walls.find((w) => w.id === "east")!;
    expect(east.x1).toBeGreaterThan(v.room.width);
  });
});
