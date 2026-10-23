import { describe, expect, it } from "vitest";
import { mostSimilar, rankSimilar, type SimilarCandidate } from "@/lib/booking/similar";
import { loadVenue } from "@/lib/venue/load";

const v = await loadVenue("halcyon");
const fees: Record<string, number> = { window: 2500, booth: 2000, counter: 1500, terrace: 2000 };
const all: SimilarCandidate[] = v.tables
  .filter((t) => t.tier !== "standard")
  .map((t) => ({ code: t.id, label: t.label, tier: t.tier, attributes: t.attributes, x: t.x, z: t.z, feeCents: fees[t.tier]! }));
const by = (code: string) => all.find((t) => t.code === code)!;
const codes = (list: SimilarCandidate[]) => list.map((t) => t.code);

describe("most similar free table", () => {
  it("prefers the same tier, then shared attributes, then distance in the room", () => {
    // Window 2 is window, water view, wheelchair accessible. Window 5 shares all three.
    // After the windows, the nearest table that shares the water view: Terrace 2.
    expect(codes(rankSimilar(by("W2"), all)).slice(0, 6)).toEqual(["W5", "W1", "W3", "W4", "W6", "T2"]);
    // Window 1 (corner) shares two with every window; the nearest comes first.
    expect(codes(rankSimilar(by("W1"), all)).slice(0, 5)).toEqual(["W2", "W3", "W4", "W5", "W6"]);
  });

  it("falls back to another tier only when the tier has nothing free", () => {
    const free = all.filter((t) => t.tier !== "window");
    // Booth 1 and the terraces share the water view; Booth 1 is nearest.
    const ranked = codes(rankSimilar(by("W6"), free));
    expect(ranked[0]).toBe("B1");
    expect(ranked).not.toContain("W6");
  });

  it("breaks ties on fee closeness", () => {
    const target: SimilarCandidate = { code: "X1", label: "X", tier: "window", attributes: [], x: 0, z: 0, feeCents: 3000 };
    const a: SimilarCandidate = { code: "A1", label: "A", tier: "window", attributes: [], x: 1, z: 0, feeCents: 2000 };
    const b: SimilarCandidate = { code: "B1", label: "B", tier: "window", attributes: [], x: 0, z: 1, feeCents: 2900 };
    expect(codes(rankSimilar(target, [a, b]))).toEqual(["B1", "A1"]);
  });

  it("returns a suggestion, or null when nothing is free", () => {
    expect(mostSimilar(by("C1"), all)).toEqual({ code: "C2", label: "Counter 2", tier: "counter", feeCents: 1500 });
    expect(mostSimilar(by("C1"), [by("C1")])).toBeNull();
    expect(mostSimilar(by("C1"), [])).toBeNull();
  });
});
