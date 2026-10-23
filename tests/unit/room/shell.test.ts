import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildShell, floorTopAt, GROUND_Y, WALL_THICKNESS } from "@/components/room/scene3d/geometry/shell";
import { DUSK, LIGHT } from "@/components/room/scene3d/palette";
import { REVIEW_SLOT, reviewAvailability, roomDataFromVenue } from "@/components/room/scene3d/roomData";
import { parseVenue } from "@/lib/venue/load";

const venues = ["halcyon", "orchard-room"].map((id) => parseVenue(readFileSync(`venues/${id}/venue.json`, "utf8"), id));

describe.each(venues.map((v) => [v.id, v] as const))("room shell for %s", (_id, venue) => {
  it.each([LIGHT, DUSK])("builds clean geometry in the %s palette", (palette) => {
    const shell = buildShell(venue, palette, venue.brand.accent);
    for (const g of [shell.clay, shell.sitOnly, shell.ground]) {
      const pos = g.attributes.position!;
      expect(pos.count).toBeGreaterThan(0);
      expect(pos.count % 3).toBe(0);
      for (let i = 0; i < pos.count; i++) expect(Number.isFinite(pos.getX(i) + pos.getY(i) + pos.getZ(i))).toBe(true);
    }
    const rise = shell.clay.attributes.rise!;
    for (let i = 0; i < rise.count; i++) {
      expect(rise.getX(i)).toBeGreaterThanOrEqual(0);
      expect(rise.getX(i)).toBeLessThanOrEqual(1);
    }
  });

  it("keeps walls outside the room's interior lines and cut at the wall height", () => {
    const shell = buildShell(venue, LIGHT, venue.brand.accent);
    const pos = shell.clay.attributes.position!;
    const rise = shell.clay.attributes.rise!;
    let top = 0;
    for (let i = 0; i < pos.count; i++) if (rise.getX(i) > 0) top = Math.max(top, pos.getY(i));
    expect(top).toBeCloseTo(venue.room.wallHeight, 6);
    expect(WALL_THICKNESS).toBe(0.2);
  });

  it("puts tables on the floor at y = 0", () => {
    for (const t of venue.tables) expect(Math.abs(floorTopAt(venue, t))).toBeLessThan(0.007);
    expect(GROUND_Y).toBeLessThan(0);
  });

  it("builds water only where venue.json has it", () => {
    const shell = buildShell(venue, LIGHT, venue.brand.accent);
    expect(shell.water !== null).toBe(venue.surroundings.water !== null);
  });
});

describe("review data", () => {
  it("prices from the lowest tier fee and books the review slot at weekend fees", () => {
    const venue = venues[0]!;
    const data = roomDataFromVenue(venue);
    const w1 = data.tables.find((t) => t.id === "W1")!;
    expect(w1.bookable).toBe(true);
    expect(w1.fromCents).toBe(2500);
    expect(w1.image?.kind).toBe("render");
    expect(data.tables.find((t) => t.id === "S1")!.image).toBeNull();
    const a = reviewAvailability(data, { taken: ["W2"], wrong: ["T1"] });
    expect(a.find((x) => x.code === "W1")).toMatchObject({ state: "available", feeCents: 4000 });
    expect(a.find((x) => x.code === "W2")!.state).toBe("taken");
    expect(a.find((x) => x.code === "T1")!.state).toBe("wrong_size");
    expect(a.find((x) => x.code === "S1")!.state).toBe("not_bookable");
    expect(REVIEW_SLOT.party).toBe(2);
  });
});
