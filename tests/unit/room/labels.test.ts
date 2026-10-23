import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  boxRect,
  fitLabels,
  type LabelBox,
  labelContent,
  labelPriority,
  PRIORITY,
  rectsOverlap,
  resolveLabels,
  roundRobinOrder,
} from "@/components/room/scene3d/labelsLayout";
import { roomDataFromVenue } from "@/components/room/scene3d/roomData";
import { tierOf } from "@/lib/room/types";
import { parseVenue } from "@/lib/venue/load";

const venue = parseVenue(readFileSync("venues/halcyon/venue.json", "utf8"), "halcyon");
const data = roomDataFromVenue(venue);
const table = (code: string) => data.tables.find((t) => t.id === code)!;

const box = (code: string, x: number, y: number, priority: number, extra: Partial<LabelBox> = {}): LabelBox => ({
  code,
  priority,
  x,
  y,
  width: 120,
  height: 28,
  offscreen: false,
  forced: false,
  depth: 10,
  ...extra,
});

describe("label content", () => {
  it("names the table, tier, seats, state and price", () => {
    const w1 = table("W1");
    const c = labelContent(w1, tierOf(venue, w1.tier), "available", {
      code: "W1",
      state: "available",
      feeCents: 4000,
      reason: null,
    });
    expect(c.title).toBe("Window 1");
    expect(c.price).toBe("$40");
    expect(c.accessibleName).toBe("Window 1, Window, 2 seats, available, $40");
    expect(c.muted).toBe(false);
  });

  it("shows the lowest fee before a slot is chosen", () => {
    const w1 = table("W1");
    expect(labelContent(w1, tierOf(venue, w1.tier), "available", null).price).toBe("from $25");
  });

  it("mutes taken and wrong-size tables and gives standard tables no price", () => {
    const b1 = table("B1");
    const taken = labelContent(b1, tierOf(venue, b1.tier), "taken", { code: "B1", state: "taken", feeCents: 3000, reason: null });
    expect(taken.muted).toBe(true);
    expect(taken.accessibleName).toBe("Booth 1, Booth, 4 seats, taken");
    const s1 = table("S1");
    const quiet = labelContent(s1, tierOf(venue, s1.tier), "not_bookable", null);
    expect(quiet.price).toBeNull();
    expect(quiet.title).toBe("Table 11");
  });
});

describe("collision pass", () => {
  it("orders selected over hovered over available over other bookable over not bookable", () => {
    expect(labelPriority("available", { selected: true, hovered: false })).toBe(PRIORITY.selected);
    expect(labelPriority("taken", { selected: false, hovered: true })).toBe(PRIORITY.hovered);
    expect(labelPriority("available", { selected: false, hovered: false })).toBe(PRIORITY.available);
    expect(labelPriority("wrong_size", { selected: false, hovered: false })).toBe(PRIORITY.bookable);
    expect(labelPriority("not_bookable", { selected: false, hovered: false })).toBe(PRIORITY.quiet);
  });

  it("never lets two shown labels overlap, and the higher priority wins", () => {
    const boxes = [
      box("A", 100, 100, PRIORITY.available),
      box("B", 150, 105, PRIORITY.selected),
      box("C", 400, 100, PRIORITY.quiet),
    ];
    const shown = resolveLabels(boxes, { width: 800, height: 600 });
    expect([...shown].sort()).toEqual(["B", "C"]);
  });

  it("keeps a focused label visible even when it collides", () => {
    const boxes = [box("A", 100, 100, PRIORITY.selected), box("F", 110, 100, PRIORITY.quiet, { forced: true })];
    expect(resolveLabels(boxes, { width: 800, height: 600 }).has("F")).toBe(true);
  });

  it("holds under a dense random scatter", () => {
    let seed = 7;
    const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const boxes = Array.from({ length: 80 }, (_, i) => box(`T${i}`, rand() * 390, rand() * 844, 1 + Math.floor(rand() * 5)));
    const shown = resolveLabels(boxes, { width: 390, height: 844 });
    const rects = boxes.filter((b) => shown.has(b.code)).map(boxRect);
    for (let i = 0; i < rects.length; i++)
      for (let j = i + 1; j < rects.length; j++) expect(rectsOverlap(rects[i]!, rects[j]!)).toBe(false);
  });

  it("spreads tiers fairly when only some labels fit", () => {
    const order = roundRobinOrder([
      { code: "W1", group: "w", x: 0, y: 0 },
      { code: "W2", group: "w", x: 10, y: 0 },
      { code: "B1", group: "b", x: 5, y: 0 },
    ]);
    expect(order.get("W1")!).toBeLessThan(order.get("W2")!);
    expect(order.get("B1")!).toBeLessThan(order.get("W2")!);
  });
});

// A row of tables 100 px apart: full pills are 150 px, title-only pills 90 px.
const row = (compact: boolean) =>
  [0, 1, 2, 3, 4].map((i) => box(`W${i + 1}`, 100 + i * 100, 200, PRIORITY.available, { width: compact ? 90 : 150 }));

// Two labels on the same spot: no width makes room for both.
const stacked = (compact: boolean) => [
  box("A", 100, 100, PRIORITY.available, { width: compact ? 90 : 150 }),
  box("B", 100, 100, PRIORITY.available),
];

describe("prices give way before names", () => {
  const viewport = { width: 800, height: 600 };

  it("keeps full pills when they all fit", () => {
    const fit = fitLabels(() => [box("A", 100, 100, PRIORITY.available), box("B", 400, 100, PRIORITY.available)], viewport);
    expect(fit.compact).toBe(false);
    expect(fit.shown.size).toBe(2);
  });

  it("drops the prices when that shows more tables", () => {
    const fit = fitLabels(row, viewport);
    expect(fit.compact).toBe(true);
    expect(fit.shown.size).toBe(5);
    const rects = fit.boxes.filter((b) => fit.shown.has(b.code)).map(boxRect);
    for (let i = 0; i < rects.length; i++)
      for (let j = i + 1; j < rects.length; j++) expect(rectsOverlap(rects[i]!, rects[j]!, 6)).toBe(false);
  });

  it("keeps the prices when dropping them would not help", () => {
    expect(fitLabels(stacked, viewport).compact).toBe(false);
  });

  it("decides from the geometry alone", () => {
    expect(fitLabels(row, viewport)).toEqual(fitLabels(row, viewport));
  });
});
