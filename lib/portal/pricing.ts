import "server-only";
import { and, asc, eq, sql } from "drizzle-orm";
import { db, PG, pgCode } from "@/db/client";
import { priceRule, turnTime } from "@/db/schema";
import type { PriceRuleView, PricingResponse } from "@/lib/api/contracts";
import type { OperatorSession } from "@/lib/auth/session";
import { ApiError } from "@/lib/http/api";
import { formatDate, isoWeekday } from "@/lib/format";
import { loadVenue } from "@/lib/venue/load";
import { audit } from "./audit";
import { turnTimeProblem, type TurnTimeRange } from "./rules";

/**
 * Fees and turn times (PRD O-3). A fee change applies to new holds only: a
 * reservation stores the price it was booked at, so existing bookings keep theirs.
 */

type RuleRow = typeof priceRule.$inferSelect;

function toView(r: RuleRow): PriceRuleView {
  return { id: r.id, tier: r.tier, daypart: r.daypart, dayType: r.dayType, specialDate: r.specialDate, feeCents: r.feeCents };
}

export async function getPricing(venueId: string): Promise<PricingResponse> {
  const [config, rules, turns] = await Promise.all([
    loadVenue(venueId),
    db()
      .select()
      .from(priceRule)
      .where(eq(priceRule.venueId, venueId))
      .orderBy(asc(priceRule.specialDate), asc(priceRule.tier), asc(priceRule.daypart)),
    db().select().from(turnTime).where(eq(turnTime.venueId, venueId)).orderBy(asc(turnTime.minParty)),
  ]);
  return {
    rules: rules.map(toView),
    turnTimes: turns.map((t) => ({ minParty: t.minParty, maxParty: t.maxParty, minutes: t.minutes })),
    dayparts: config.booking.dayparts.map((d) => ({ id: d.id, name: d.name, start: d.start, end: d.end, days: d.days })),
    tiers: config.tiers.map((t) => ({ id: t.id, name: t.name, color: t.color, bookable: t.bookable })),
  };
}

export interface RuleInput {
  tier: string;
  daypart: string;
  dayType: "weeknight" | "weekend" | "special";
  specialDate?: string | null;
  feeCents: number;
}

export async function saveRule(op: OperatorSession, input: RuleInput, today: string): Promise<PriceRuleView> {
  const config = await loadVenue(op.venueId);
  if (!config.tiers.some((t) => t.id === input.tier)) throw new ApiError(422, "unknown_tier", "Choose one of the venue's tiers.");
  const daypart = config.booking.dayparts.find((d) => d.id === input.daypart);
  if (!daypart) throw new ApiError(422, "unknown_daypart", "Choose one of the venue's services.");
  const specialDate = input.dayType === "special" ? (input.specialDate ?? null) : null;
  if (specialDate) {
    if (specialDate < today) throw new ApiError(422, "date_in_past", "Choose today or a later date.");
    if (!daypart.days.includes(isoWeekday(specialDate))) {
      throw new ApiError(
        422,
        "daypart_closed",
        `${daypart.name} does not run on ${formatDate(specialDate, { weekday: "long" })}.`,
      );
    }
  }

  try {
    return await upsertRule(op, input, specialDate);
  } catch (e) {
    if (pgCode(e) === PG.uniqueViolation) {
      throw new ApiError(409, "rule_conflict", "Someone saved this fee at the same moment. Reload and try again.");
    }
    throw e;
  }
}

function upsertRule(op: OperatorSession, input: RuleInput, specialDate: string | null): Promise<PriceRuleView> {
  return db().transaction(async (tx) => {
    const key = and(
      eq(priceRule.venueId, op.venueId),
      eq(priceRule.tier, input.tier),
      eq(priceRule.daypart, input.daypart),
      eq(priceRule.dayType, input.dayType),
      specialDate ? eq(priceRule.specialDate, specialDate) : sql`${priceRule.specialDate} IS NULL`,
    );
    const [before] = await tx.select().from(priceRule).where(key).for("update");
    let saved: RuleRow;
    if (before) {
      [saved] = (await tx
        .update(priceRule)
        .set({ feeCents: input.feeCents, updatedAt: new Date(), updatedBy: op.operatorId })
        .where(eq(priceRule.id, before.id))
        .returning()) as [RuleRow];
    } else {
      [saved] = (await tx
        .insert(priceRule)
        .values({
          venueId: op.venueId,
          tier: input.tier,
          daypart: input.daypart,
          dayType: input.dayType,
          specialDate,
          feeCents: input.feeCents,
          updatedBy: op.operatorId,
        })
        .returning()) as [RuleRow];
    }
    if (!before || before.feeCents !== input.feeCents) {
      await audit(
        tx,
        op,
        "price_rule.saved",
        {
          rule: saved.id,
          tier: input.tier,
          daypart: input.daypart,
          dayType: input.dayType,
          specialDate,
          fromCents: before?.feeCents ?? null,
          toCents: input.feeCents,
        },
        input.feeCents,
      );
    }
    return toView(saved);
  });
}

export async function deleteRule(op: OperatorSession, id: string): Promise<void> {
  await db().transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(priceRule)
      .where(and(eq(priceRule.id, id), eq(priceRule.venueId, op.venueId)))
      .for("update");
    if (!row) throw new ApiError(404, "rule_not_found", "That fee is not in this venue.");
    if (row.dayType !== "special") {
      throw new ApiError(409, "not_special", "Weeknight and weekend fees can be changed but not removed.");
    }
    await tx.delete(priceRule).where(eq(priceRule.id, row.id));
    await audit(
      tx,
      op,
      "price_rule.deleted",
      {
        rule: row.id,
        tier: row.tier,
        daypart: row.daypart,
        dayType: row.dayType,
        specialDate: row.specialDate,
        feeCents: row.feeCents,
      },
      row.feeCents,
    );
  });
}

export async function saveTurnTimes(op: OperatorSession, ranges: TurnTimeRange[]): Promise<TurnTimeRange[]> {
  const config = await loadVenue(op.venueId);
  const problem = turnTimeProblem(ranges, config.booking.maxParty);
  if (problem) throw new ApiError(422, "turn_time_gaps", problem);
  const sorted = [...ranges].sort((a, b) => a.minParty - b.minParty);
  return db().transaction(async (tx) => {
    const before = await tx
      .select()
      .from(turnTime)
      .where(eq(turnTime.venueId, op.venueId))
      .orderBy(asc(turnTime.minParty))
      .for("update");
    await tx.delete(turnTime).where(eq(turnTime.venueId, op.venueId));
    await tx.insert(turnTime).values(sorted.map((t) => ({ venueId: op.venueId, ...t })));
    await audit(tx, op, "turn_times.saved", {
      from: before.map((t) => ({ minParty: t.minParty, maxParty: t.maxParty, minutes: t.minutes })),
      to: sorted,
    });
    return sorted;
  });
}
