import { describe, expect, it } from "vitest";
import { applicationFeeCents, dayTypeOf, type PriceRuleLike, priceFor, specialDates } from "@/lib/booking/pricing";
import { loadVenue } from "@/lib/venue/load";

const v = await loadVenue("halcyon");
/** The rules the seed writes from venue.json: one per tier, daypart and day type. */
const base: PriceRuleLike[] = Object.entries(v.booking.fees).flatMap(([tier, fee]) =>
  v.booking.dayparts.flatMap((d) => [
    { tier, daypart: d.id, dayType: "weeknight" as const, specialDate: null, feeCents: fee.weeknight },
    { tier, daypart: d.id, dayType: "weekend" as const, specialDate: null, feeCents: fee.weekend },
  ]),
);
const weekend = v.booking.weekendDays;

describe("pricing (PRD fees, S-1)", () => {
  it("weeknight and weekend fees per tier", () => {
    const wed = "2026-11-04";
    const fri = "2026-11-06";
    expect(priceFor(base, weekend, { tier: "window", daypart: "dinner", date: wed })).toEqual({
      feeCents: 2500,
      dayType: "weeknight",
    });
    expect(priceFor(base, weekend, { tier: "window", daypart: "dinner", date: fri })).toEqual({
      feeCents: 4000,
      dayType: "weekend",
    });
    expect(priceFor(base, weekend, { tier: "booth", daypart: "dinner", date: fri })?.feeCents).toBe(3000);
    expect(priceFor(base, weekend, { tier: "counter", daypart: "dinner", date: wed })?.feeCents).toBe(1500);
    expect(priceFor(base, weekend, { tier: "terrace", daypart: "lunch", date: "2026-11-07" })?.feeCents).toBe(3500);
    // Sunday is priced as a weeknight (weekendDays are Friday and Saturday).
    expect(priceFor(base, weekend, { tier: "window", daypart: "lunch", date: "2026-11-08" })).toEqual({
      feeCents: 2500,
      dayType: "weeknight",
    });
  });

  it("a special date overrides its tier's fee; other tiers keep their day's fee", () => {
    const rules: PriceRuleLike[] = [
      ...base,
      { tier: "window", daypart: "dinner", dayType: "special", specialDate: "2026-12-31", feeCents: 9000 },
    ];
    expect(specialDates(rules)).toEqual(new Set(["2026-12-31"]));
    expect(dayTypeOf(rules, weekend, "2026-12-31")).toBe("special");
    expect(priceFor(rules, weekend, { tier: "window", daypart: "dinner", date: "2026-12-31" })).toEqual({
      feeCents: 9000,
      dayType: "special",
    });
    // Thursday Dec 31: the booth has no special rule, so its weeknight fee applies.
    expect(priceFor(rules, weekend, { tier: "booth", daypart: "dinner", date: "2026-12-31" })).toEqual({
      feeCents: 2000,
      dayType: "special",
    });
    expect(priceFor(rules, weekend, { tier: "window", daypart: "dinner", date: "2026-12-30" })?.feeCents).toBe(2500);
  });

  it("no rule means no price", () => {
    expect(priceFor(base, weekend, { tier: "standard", daypart: "dinner", date: "2026-11-04" })).toBeNull();
    expect(priceFor([], weekend, { tier: "window", daypart: "dinner", date: "2026-11-04" })).toBeNull();
  });

  it("application fee is round(price x bps / 10000)", () => {
    expect(applicationFeeCents(4000, 3000)).toBe(1200);
    expect(applicationFeeCents(2500, 3000)).toBe(750);
    expect(applicationFeeCents(1250, 3333)).toBe(417);
    expect(applicationFeeCents(1, 5000)).toBe(1);
    expect(applicationFeeCents(2500, 0)).toBe(0);
  });
});
