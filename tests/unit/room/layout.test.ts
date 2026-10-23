import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { tableGeometry } from "@/components/room/scene3d/geometry/furniture";
import { localToWorldPoint, seatOnBanquette, tablePlacements, worldToLocal } from "@/components/room/scene3d/layout";
import { BOOTH_ARC_DEGREES, labelAnchor, ring, rotationY, SEAT_HEIGHT, seats } from "@/lib/venue/geometry";
import { parseVenue } from "@/lib/venue/load";

const venues = ["halcyon", "orchard-room"].map((id) => parseVenue(readFileSync(`venues/${id}/venue.json`, "utf8"), id));

const colors = {
  top: "#ddd",
  base: "#888",
  wood: "#a86",
  upholstery: "#ccc",
  plate: "#fff",
  glassware: "#eee",
  votive: "#fff",
  outdoor: false,
};

describe.each(venues.map((v) => [v.id, v] as const))("layout truth in %s", (_id, venue) => {
  const placements = tablePlacements(venue);

  it("puts every table group exactly at venue.json (x, 0, z) with rotationY(rotation)", () => {
    expect(placements).toHaveLength(venue.tables.length);
    venue.tables.forEach((t, i) => {
      const p = placements[i]!;
      expect(p.code).toBe(t.id);
      expect(p.position).toEqual({ x: t.x, y: 0, z: t.z });
      expect(p.rotationY).toBe(rotationY(t.rotation));
    });
  });

  it("puts every chair exactly on seats(), and every other seat on a bench or banquette", () => {
    venue.tables.forEach((t, i) => {
      const p = placements[i]!;
      const all = seats(t);
      expect(p.chairs.length + p.benchSeats.length).toBe(all.length);
      for (const c of p.chairs) {
        const match = all.find((s) => s.x === c.x && s.z === c.z);
        expect(match, `${t.id} chair at ${c.x},${c.z}`).toBeDefined();
        expect(c.facing).toBe(match!.facing);
        expect(c.rotationY).toBe(rotationY(match!.facing));
        expect(c.main).toBe(match!.main);
      }
      for (const s of p.benchSeats) expect(s.kind === "bench" || seatOnBanquette(s, venue.fixtures) !== null).toBe(true);
    });
  });

  it("builds each chair into the table mesh at its seat, seat top at 45 cm", () => {
    venue.tables.forEach((t, i) => {
      const p = placements[i]!;
      if (!p.chairs.length) return;
      const geo = tableGeometry(t, p, colors, BOOTH_ARC_DEGREES);
      const pos = geo.attributes.position!;
      for (const c of p.chairs) {
        const local = worldToLocal(p, c.x, c.z);
        let found = false;
        for (let k = 0; k < pos.count && !found; k++) {
          const dx = pos.getX(k) - local.x;
          const dz = pos.getZ(k) - local.z;
          // The cushion top is outlined by its rounded corners, about 0.3 m from the seat center.
          if (Math.hypot(dx, dz) < 0.32 && Math.abs(pos.getY(k) - SEAT_HEIGHT) < 0.002) found = true;
        }
        expect(found, `${t.id} chair seat at its seat position`).toBe(true);
      }
      geo.dispose();
    });
  });

  it("uses ring() for every floor ring and labelAnchor() for every label", () => {
    venue.tables.forEach((t, i) => {
      expect(placements[i]!.ring).toEqual(ring(t));
      expect(placements[i]!.label).toEqual(labelAnchor(t));
    });
  });

  it("converts between world and table-local coordinates without drift", () => {
    for (const p of placements) {
      for (const [x, z] of [
        [0.3, -0.2],
        [-1.1, 0.7],
      ] as const) {
        const w = localToWorldPoint(p, x, z);
        const back = worldToLocal(p, w.x, w.z);
        expect(back.x).toBeCloseTo(x, 9);
        expect(back.z).toBeCloseTo(z, 9);
      }
    }
  });
});

describe("local frames agree with geometry.ts", () => {
  it("a table's local -z points toward its compass rotation", () => {
    const venue = venues[0]!;
    for (const p of tablePlacements(venue)) {
      const t = venue.tables.find((x) => x.id === p.code)!;
      const ahead = localToWorldPoint(p, 0, -1);
      const r = (t.rotation * Math.PI) / 180;
      expect(ahead.x - t.x).toBeCloseTo(Math.sin(r), 9);
      expect(ahead.z - t.z).toBeCloseTo(-Math.cos(r), 9);
    }
  });
});
