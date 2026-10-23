import { and, desc, eq, isNull } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { DELETE as deleteRuleRoute } from "@/app/api/portal/pricing/rules/[id]/route";
import { PUT as ruleRoute } from "@/app/api/portal/pricing/rules/route";
import { GET as pricingRoute } from "@/app/api/portal/pricing/route";
import { PATCH as tableRoute } from "@/app/api/portal/tables/[code]/route";
import { GET as tablesRoute } from "@/app/api/portal/tables/route";
import { PUT as turnTimesRoute } from "@/app/api/portal/turn-times/route";
import { db } from "@/db/client";
import { auditLog, priceRule, turnTime, venueTable } from "@/db/schema";
import type { PricingResponse, TablesResponse } from "@/lib/api/contracts";
import { addDays, isoWeekday, todayIn } from "@/lib/format";
import { parseDollars } from "@/lib/portal/money";
import { call, errorCode, HALCYON_OWNER, request, signIn } from "./helpers";

let owner: string;
const today = todayIn("America/Los_Angeles");

/** The next date after today that falls on an ISO weekday. */
function nextWeekday(day: number): string {
  let d = addDays(today, 1);
  while (isoWeekday(d) !== day) d = addDays(d, 1);
  return d;
}

async function lastAudit(action: string) {
  const [row] = await db()
    .select()
    .from(auditLog)
    .where(and(eq(auditLog.venueId, "halcyon"), eq(auditLog.action, action)))
    .orderBy(desc(auditLog.id))
    .limit(1);
  return row;
}

const put = (body: unknown) => call(ruleRoute, request("PUT", "/api/portal/pricing/rules", { cookie: owner, body }));

beforeAll(async () => {
  owner = await signIn(HALCYON_OWNER);
});

describe("pricing (O-3)", () => {
  it("lists fees, dayparts, tiers and turn times", async () => {
    const r = await call<PricingResponse>(pricingRoute, request("GET", "/api/portal/pricing", { cookie: owner }));
    expect(r.status).toBe(200);
    expect(r.body.dayparts.map((d) => d.id)).toEqual(["lunch", "dinner"]);
    expect(r.body.turnTimes).toEqual([
      { minParty: 1, maxParty: 2, minutes: 90 },
      { minParty: 3, maxParty: 4, minutes: 120 },
      { minParty: 5, maxParty: 6, minutes: 150 },
    ]);
    const windowWeekend = r.body.rules.find((x) => x.tier === "window" && x.daypart === "dinner" && x.dayType === "weekend");
    expect(windowWeekend?.feeCents).toBe(4000);
  });

  it("stores a dollar fee as exact cents and writes an audit row with before and after", async () => {
    const cents = parseDollars("42.10")!;
    expect(cents).toBe(4210);
    const r = await put({ tier: "booth", daypart: "dinner", dayType: "weekend", feeCents: cents });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({
      rule: { tier: "booth", daypart: "dinner", dayType: "weekend", specialDate: null, feeCents: 4210 },
    });
    const rows = await db()
      .select()
      .from(priceRule)
      .where(
        and(
          eq(priceRule.venueId, "halcyon"),
          eq(priceRule.tier, "booth"),
          eq(priceRule.daypart, "dinner"),
          eq(priceRule.dayType, "weekend"),
          isNull(priceRule.specialDate),
        ),
      );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.feeCents).toBe(4210);

    const audit = await lastAudit("price_rule.saved");
    expect(audit).toMatchObject({ actorType: "operator", amountCents: 4210 });
    expect(audit?.details).toMatchObject({
      tier: "booth",
      daypart: "dinner",
      dayType: "weekend",
      fromCents: 3000,
      toCents: 4210,
    });
    expect(audit?.actorId).toBeTruthy();
  });

  it("refuses a special-date rule without a date, and a date on a weekly rule", async () => {
    const noDate = await put({ tier: "window", daypart: "dinner", dayType: "special", feeCents: 5000 });
    expect(noDate.status).toBe(400);
    expect(noDate.body).toMatchObject({
      error: { code: "invalid_request", issues: [{ message: "Special-date rules need a date" }] },
    });
    const strayDate = await put({
      tier: "window",
      daypart: "dinner",
      dayType: "weeknight",
      specialDate: nextWeekday(2),
      feeCents: 5000,
    });
    expect(strayDate.status).toBe(400);
  });

  it("refuses unknown tiers and services, negative or huge fees, past dates and closed services", async () => {
    expect(errorCode(await put({ tier: "rooftop", daypart: "dinner", dayType: "weeknight", feeCents: 100 }))).toBe(
      "unknown_tier",
    );
    expect(errorCode(await put({ tier: "window", daypart: "brunch", dayType: "weeknight", feeCents: 100 }))).toBe(
      "unknown_daypart",
    );
    expect((await put({ tier: "window", daypart: "dinner", dayType: "weeknight", feeCents: -1 })).status).toBe(400);
    expect((await put({ tier: "window", daypart: "dinner", dayType: "weeknight", feeCents: 100_001 })).status).toBe(400);
    expect((await put({ tier: "window", daypart: "dinner", dayType: "weeknight", feeCents: 12.5 })).status).toBe(400);
    const past = await put({
      tier: "window",
      daypart: "dinner",
      dayType: "special",
      specialDate: addDays(today, -1),
      feeCents: 100,
    });
    expect(errorCode(past)).toBe("date_in_past");
    // Lunch runs Friday to Sunday only.
    const monday = await put({
      tier: "window",
      daypart: "lunch",
      dayType: "special",
      specialDate: nextWeekday(1),
      feeCents: 100,
    });
    expect(errorCode(monday)).toBe("daypart_closed");
  });

  it("adds, updates and deletes a special-date fee; weekly fees cannot be deleted", async () => {
    const date = nextWeekday(4);
    const first = await put({ tier: "window", daypart: "dinner", dayType: "special", specialDate: date, feeCents: 6500 });
    expect(first.status).toBe(200);
    const again = await put({ tier: "window", daypart: "dinner", dayType: "special", specialDate: date, feeCents: 7000 });
    const id = (again.body as { rule: { id: string } }).rule.id;
    expect(id).toBe((first.body as { rule: { id: string } }).rule.id);
    expect((await db().select().from(priceRule).where(eq(priceRule.id, id)))[0]?.feeCents).toBe(7000);

    const del = await call(deleteRuleRoute, request("DELETE", `/api/portal/pricing/rules/${id}`, { cookie: owner }), { id });
    expect(del.status).toBe(200);
    expect(await db().select().from(priceRule).where(eq(priceRule.id, id))).toHaveLength(0);
    expect((await lastAudit("price_rule.deleted"))?.details).toMatchObject({ rule: id, specialDate: date, feeCents: 7000 });

    const [weekly] = await db()
      .select()
      .from(priceRule)
      .where(and(eq(priceRule.venueId, "halcyon"), eq(priceRule.dayType, "weeknight")))
      .limit(1);
    const refused = await call(deleteRuleRoute, request("DELETE", `/api/portal/pricing/rules/${weekly!.id}`, { cookie: owner }), {
      id: weekly!.id,
    });
    expect(refused.status).toBe(409);
    expect(errorCode(refused)).toBe("not_special");
  });
});

const save = (turnTimes: unknown) =>
  call(turnTimesRoute, request("PUT", "/api/portal/turn-times", { cookie: owner, body: { turnTimes } }));
const patch = (code: string, body: unknown) =>
  call(tableRoute, request("PATCH", `/api/portal/tables/${code}`, { cookie: owner, body }), { code });

describe("turn times", () => {
  it("refuses gaps, overlaps, missing sizes and ranges that do not start at 1", async () => {
    const gap = await save([
      { minParty: 1, maxParty: 2, minutes: 90 },
      { minParty: 4, maxParty: 6, minutes: 150 },
    ]);
    expect(gap.status).toBe(422);
    expect(gap.body).toMatchObject({ error: { code: "turn_time_gaps", message: "Parties of 3 have no turn time." } });

    const short = await save([{ minParty: 1, maxParty: 4, minutes: 90 }]);
    expect(short.body).toMatchObject({ error: { code: "turn_time_gaps", message: "Parties of 5 to 6 have no turn time." } });

    const overlap = await save([
      { minParty: 1, maxParty: 3, minutes: 90 },
      { minParty: 3, maxParty: 6, minutes: 120 },
    ]);
    expect(overlap.body).toMatchObject({ error: { code: "turn_time_gaps", message: "Party size 3 is covered twice." } });

    const late = await save([{ minParty: 2, maxParty: 6, minutes: 90 }]);
    expect(late.body).toMatchObject({ error: { message: "Parties of 1 have no turn time." } });

    const tooQuick = await save([{ minParty: 1, maxParty: 6, minutes: 20 }]);
    expect(tooQuick.status).toBe(400);

    const rows = await db().select().from(turnTime).where(eq(turnTime.venueId, "halcyon"));
    expect(rows).toHaveLength(3);
  });

  it("saves a full set in any order and audits it", async () => {
    const r = await save([
      { minParty: 5, maxParty: 6, minutes: 165 },
      { minParty: 1, maxParty: 2, minutes: 90 },
      { minParty: 3, maxParty: 4, minutes: 120 },
    ]);
    expect(r.status).toBe(200);
    expect(r.body).toEqual({
      turnTimes: [
        { minParty: 1, maxParty: 2, minutes: 90 },
        { minParty: 3, maxParty: 4, minutes: 120 },
        { minParty: 5, maxParty: 6, minutes: 165 },
      ],
    });
    const audit = await lastAudit("turn_times.saved");
    const details = audit?.details as { from: { minutes: number }[]; to: { minutes: number }[] } | undefined;
    expect(details?.from.at(-1)?.minutes).toBe(150);
    expect(details?.to.at(-1)?.minutes).toBe(165);
  });
});

describe("tables", () => {
  it("lists tables with tiers and the attribute vocabulary", async () => {
    const r = await call<TablesResponse>(tablesRoute, request("GET", "/api/portal/tables", { cookie: owner }));
    expect(r.body.tables).toHaveLength(25);
    expect(r.body.tables[0]).toMatchObject({ code: "W1", label: "Window 1", tier: "window", bookable: true });
    expect(r.body.attributes).toContain("wheelchair accessible");
    expect(r.body.tiers.find((t) => t.id === "standard")?.bookable).toBe(false);
  });

  it("turns a table off and on, changes its tier and attributes, and audits each change", async () => {
    expect((await patch("W6", { bookable: false })).body).toMatchObject({ table: { code: "W6", bookable: false } });
    expect((await lastAudit("table.updated"))?.details).toEqual({
      table: "W6",
      changes: { bookable: { from: true, to: false } },
    });
    expect((await patch("W6", { bookable: true })).body).toMatchObject({ table: { bookable: true } });

    const r = await patch("W6", { tier: "booth", attributes: ["window", "quiet", "corner"] });
    expect(r.body).toMatchObject({ table: { tier: "booth", attributes: ["window", "quiet", "corner"] } });
    expect((await lastAudit("table.updated"))?.details).toMatchObject({
      table: "W6",
      changes: {
        tier: { from: "window", to: "booth" },
        attributes: { from: ["window", "water view"], to: ["window", "quiet", "corner"] },
      },
    });
    await patch("W6", { tier: "window", attributes: ["window", "water view"] });
  });

  it("refuses more than 3 attributes, unknown attributes and tiers, and empty changes", async () => {
    expect((await patch("W1", { attributes: ["window", "quiet", "corner", "heated"] })).status).toBe(400);
    expect(errorCode(await patch("W1", { attributes: ["sea monster"] }))).toBe("unknown_attribute");
    expect(errorCode(await patch("W1", { tier: "rooftop" }))).toBe("unknown_tier");
    expect((await patch("W1", {})).status).toBe(400);
    expect((await patch("Z9", { bookable: false })).status).toBe(404);
  });

  it("keeps tables of an unpriced tier off", async () => {
    const r = await patch("S1", { bookable: true });
    expect(r.status).toBe(422);
    expect(r.body).toMatchObject({
      error: { code: "tier_not_priced", message: "Dining room tables have no fees, so they cannot be booked online." },
    });
    const [row] = await db()
      .select({ bookable: venueTable.bookable })
      .from(venueTable)
      .where(and(eq(venueTable.venueId, "halcyon"), eq(venueTable.code, "S1")));
    expect(row?.bookable).toBe(false);
  });
});
