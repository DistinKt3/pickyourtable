import type { DayType } from "@/db/schema";
import { dayTypeFor } from "./slots";

/**
 * Table fees (PRD S-1: prices are computed only on the server). A fee comes from the
 * venue's price rules for (tier, daypart, day type). On a special date a tier without
 * its own special rule keeps its weekend or weeknight fee.
 */

export interface PriceRuleLike {
  tier: string;
  daypart: string;
  dayType: DayType;
  /** YYYY-MM-DD, only for special-date rules. */
  specialDate: string | null;
  feeCents: number;
}

export interface SlotPrice {
  feeCents: number;
  dayType: DayType;
}

export function specialDates(rules: readonly PriceRuleLike[]): Set<string> {
  return new Set(rules.filter((r) => r.dayType === "special" && r.specialDate).map((r) => r.specialDate!));
}

/** The day type of a date for this venue's rules. */
export function dayTypeOf(rules: readonly PriceRuleLike[], weekendDays: readonly number[], date: string): DayType {
  return dayTypeFor(date, weekendDays, specialDates(rules));
}

/** The fee for one tier in one slot, or null when the venue has no price for it. */
export function priceFor(
  rules: readonly PriceRuleLike[],
  weekendDays: readonly number[],
  slot: { tier: string; daypart: string; date: string },
): SlotPrice | null {
  const dayType = dayTypeOf(rules, weekendDays, slot.date);
  const match = (type: DayType, date: string | null) =>
    rules.find((r) => r.tier === slot.tier && r.daypart === slot.daypart && r.dayType === type && r.specialDate === date);
  if (dayType === "special") {
    const special = match("special", slot.date);
    if (special) return { feeCents: special.feeCents, dayType };
    const base = match(dayTypeFor(slot.date, weekendDays, new Set()), null);
    return base ? { feeCents: base.feeCents, dayType } : null;
  }
  const rule = match(dayType, null);
  return rule ? { feeCents: rule.feeCents, dayType } : null;
}

/** The platform's share of a fee: round(price x bps / 10000). */
export function applicationFeeCents(priceCents: number, applicationFeeBps: number): number {
  return Math.round((priceCents * applicationFeeBps) / 10_000);
}
