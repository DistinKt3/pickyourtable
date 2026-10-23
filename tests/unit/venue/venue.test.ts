import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  bearing,
  mainSeat,
  ring,
  ringsOverlap,
  seats,
  seatView,
  seatViewFov,
  tableSize,
  verticalFovForAspect,
} from "@/lib/venue/geometry";
import { listVenueIds, loadVenue, parseVenue } from "@/lib/venue/load";

const halcyonJson = readFileSync("venues/halcyon/venue.json", "utf8");

describe("venue data contract (D-1)", () => {
  it("validates every venue folder", async () => {
    const ids = await listVenueIds();
    expect(ids).toEqual(expect.arrayContaining(["halcyon", "orchard-room"]));
    for (const id of ids) await expect(loadVenue(id)).resolves.toMatchObject({ id });
  });

  it("Halcyon matches the PRD's room and table mix", async () => {
    const v = await loadVenue("halcyon");
    expect(v.room).toMatchObject({ width: 20, depth: 12, wallHeight: 1.1 });
    expect(v.demo).toBe(true);
    const count = (tier: string) => v.tables.filter((t) => t.tier === tier).length;
    expect(count("window")).toBe(6);
    expect(count("booth")).toBe(4);
    expect(count("counter")).toBe(3);
    expect(count("terrace")).toBe(4);
    expect(count("standard")).toBe(8);
    expect(v.tables.filter((t) => t.tier === "booth").every((t) => t.seats === 4 && t.shape === "booth")).toBe(true);
    expect(v.tables.filter((t) => t.tier === "counter").every((t) => t.seats === 2)).toBe(true);
    expect(v.tables.filter((t) => t.tier === "terrace").every((t) => t.seats === 4 && t.x < 0)).toBe(true);
    expect(v.tables.filter((t) => t.tier === "window").every((t) => t.seats === 2 && t.z < 2)).toBe(true);
    expect(v.tiers.find((t) => t.id === "standard")?.bookable).toBe(false);
    expect(v.booking.fees).toEqual({
      window: { weeknight: 2500, weekend: 4000 },
      booth: { weeknight: 2000, weekend: 3000 },
      counter: { weeknight: 1500, weekend: 2500 },
      terrace: { weeknight: 2000, weekend: 3500 },
    });
    expect(v.booking.holdMinutes).toBe(8);
    expect(v.booking.turnTimes).toEqual([
      { minParty: 1, maxParty: 2, minutes: 90 },
      { minParty: 3, maxParty: 4, minutes: 120 },
      { minParty: 5, maxParty: 6, minutes: 150 },
    ]);
  });

  it("the second fixture has a different layout, zone, tiers and dayparts", async () => {
    const a = await loadVenue("halcyon");
    const b = await loadVenue("orchard-room");
    expect(b.timezone).not.toBe(a.timezone);
    expect(b.room.width).not.toBe(a.room.width);
    expect(b.tiers.map((t) => t.id)).not.toEqual(a.tiers.map((t) => t.id));
    expect(b.booking.dayparts.map((d) => d.id)).not.toEqual(a.booking.dayparts.map((d) => d.id));
  });

  it.each(["halcyon", "orchard-room"])("no two table footprints overlap in %s", async (id) => {
    const v = await loadVenue(id);
    for (let i = 0; i < v.tables.length; i++) {
      for (let j = i + 1; j < v.tables.length; j++) {
        const a = v.tables[i]!;
        const b = v.tables[j]!;
        expect(ringsOverlap(ring(a), ring(b)), `${a.id} overlaps ${b.id}`).toBe(false);
      }
    }
  });

  it("rejects duplicate ids, unknown tiers and impossible party ranges", () => {
    const base = JSON.parse(halcyonJson);
    const dup = structuredClone(base);
    dup.tables[1].id = dup.tables[0].id;
    expect(() => parseVenue(JSON.stringify(dup))).toThrow(/duplicate table id/);

    const tier = structuredClone(base);
    tier.tables[0].tier = "rooftop";
    expect(() => parseVenue(JSON.stringify(tier))).toThrow(/unknown tier/);

    const party = structuredClone(base);
    party.tables[0].maxParty = 5;
    expect(() => parseVenue(JSON.stringify(party))).toThrow(/maxParty exceeds seats/);

    const gaps = structuredClone(base);
    gaps.booking.turnTimes = [
      { minParty: 1, maxParty: 2, minutes: 90 },
      { minParty: 4, maxParty: 6, minutes: 150 },
    ];
    expect(() => parseVenue(JSON.stringify(gaps))).toThrow(/without gaps/);

    expect(() => parseVenue("{not json")).toThrow(/invalid JSON/);
  });
});

describe("geometry", () => {
  it("compass bearings map north to -z and east to +x", () => {
    expect(bearing(0).x).toBeCloseTo(0);
    expect(bearing(0).z).toBeCloseTo(-1);
    expect(bearing(90).x).toBeCloseTo(1);
    expect(bearing(180).z).toBeCloseTo(1);
  });

  it("the 26 mm lens is about 69 x 50 degrees, never ultra-wide in portrait", () => {
    expect(seatViewFov.horizontal).toBeCloseTo(69.4, 1);
    expect(seatViewFov.vertical).toBeCloseTo(49.6, 1);
    // A 390 x 844 phone keeps the same diagonal.
    const v = verticalFovForAspect(390 / 844);
    expect(v).toBeGreaterThan(60);
    expect(v).toBeLessThan(80);
  });

  it("every table has one main seat and as many seats as it says", async () => {
    for (const id of await listVenueIds()) {
      const v = await loadVenue(id);
      for (const t of v.tables) {
        const s = seats(t);
        expect(s).toHaveLength(t.seats);
        expect(s.filter((x) => x.main)).toHaveLength(1);
      }
    }
  });

  it("the Window 1 seat view sits at 1.15 m behind the table, facing the water", async () => {
    const v = await loadVenue("halcyon");
    const w1 = v.tables.find((t) => t.id === "W1")!;
    const seat = mainSeat(w1);
    expect(seat.z).toBeGreaterThan(w1.z);
    const view = seatView(w1);
    expect(view.position.y).toBe(1.15);
    expect(view.direction.z).toBeLessThan(-0.9);
    expect(tableSize(w1)).toEqual({ width: 0.7, depth: 0.7 });
  });
});
