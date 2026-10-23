import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GET as availabilityGet } from "@/app/api/v/[venue]/availability/route";
import { GET as slotsGet } from "@/app/api/v/[venue]/slots/route";
import { GET as timesGet } from "@/app/api/v/[venue]/tables/[code]/times/route";
import { POST as webhookPost } from "@/app/api/stripe/webhook/route";
import { db } from "@/db/client";
import { blackout, venue, venueTable } from "@/db/schema";
import type { AvailabilityResponse, SlotsResponse, TableTimesResponse } from "@/lib/api/contracts";
import { setFlag, WIDGET_FLAG } from "@/lib/flags";
import { zonedInstant } from "@/lib/booking/time";
import { addDays } from "@/lib/format";
import { call, day, heldOk, hold, LA, nextIp, nextWeekday, resetBookingData } from "./helpers";

function availability(date: string, time: string, party = 2, ip?: string, venueId = "halcyon") {
  return call<AvailabilityResponse & { error?: { code: string; message: string } }>(
    availabilityGet,
    `/api/v/${venueId}/availability?date=${date}&time=${time}&party=${party}`,
    { venue: venueId },
    { ip },
  );
}

async function tableId(code: string, venueId = "halcyon"): Promise<string> {
  const [t] = await db()
    .select({ id: venueTable.id })
    .from(venueTable)
    .where(sql`${venueTable.venueId} = ${venueId} AND ${venueTable.code} = ${code}`);
  return t!.id;
}

beforeAll(async () => {
  process.env.SIM_WEBHOOK_DELIVERY = "inline";
  await resetBookingData();
});

afterAll(async () => {
  await setFlag(WIDGET_FLAG, true);
});

describe("availability (G-2)", () => {
  it("answers every table with its state, server fee and a plain reason", async () => {
    const wed = nextWeekday(3);
    const res = await availability(wed, "19:00", 4);
    expect(res.status).toBe(200);
    const by = new Map(res.body.tables.map((t) => [t.code, t]));
    expect(res.body.slot).toMatchObject({
      date: wed,
      time: "19:00",
      daypart: "dinner",
      daypartName: "Dinner",
      dayType: "weeknight",
    });
    // 120 minutes for a party of 4.
    expect(new Date(res.body.slot.endsAt).getTime() - new Date(res.body.slot.startsAt).getTime()).toBe(120 * 60_000);
    expect(by.get("W1")).toEqual({ code: "W1", state: "wrong_size", feeCents: 2500, reason: "Seats 2. Your party is 4." });
    expect(by.get("B1")).toEqual({ code: "B1", state: "available", feeCents: 2000, reason: null });
    expect(by.get("S1")).toMatchObject({
      state: "not_bookable",
      feeCents: null,
      reason: "The host seats this table on arrival.",
    });

    const one = await availability(wed, "19:00", 1);
    expect(one.body.tables.find((t) => t.code === "B2")).toMatchObject({
      state: "wrong_size",
      reason: "For 2 to 4 guests. Your party is 1.",
    });
  });

  it("prices Friday as weekend and Sunday as weeknight", async () => {
    const fri = await availability(nextWeekday(5), "20:00");
    expect(fri.body.slot.dayType).toBe("weekend");
    expect(fri.body.tables.find((t) => t.code === "W2")?.feeCents).toBe(4000);
    const sun = await availability(nextWeekday(7), "20:00");
    expect(sun.body.slot.dayType).toBe("weeknight");
    expect(sun.body.tables.find((t) => t.code === "W2")?.feeCents).toBe(2500);
  });

  it("refuses times outside service, too soon, or past the booking window, in plain words", async () => {
    const noService = await availability(nextWeekday(2), "15:00");
    expect(noService.status).toBe(422);
    expect(noService.body.error).toMatchObject({
      code: "slot_unavailable",
      message: "There is no seating at this time. Choose another time.",
    });
    const lunchMonday = await availability(nextWeekday(1), "12:00");
    expect(lunchMonday.status).toBe(422);
    const tooFar = await availability(day(61), "19:00");
    expect(tooFar.body.error).toMatchObject({
      code: "slot_unavailable",
      message: "Bookings open 60 days ahead. Choose an earlier date.",
    });
    const yesterday = await availability(day(-1), "19:00");
    expect(yesterday.body.error?.message).toBe("Online booking closes 1 hour before each time. Choose a later time.");
    const unknown = await availability(day(5), "19:00", 2, undefined, "nowhere");
    expect(unknown.status).toBe(404);
  });

  it("a hold makes the table taken for every slot it overlaps, and only those", async () => {
    const date = day(9);
    await heldOk({ table: "W1", date, time: "19:00" });
    const at = async (time: string) => (await availability(date, time)).body.tables.find((t) => t.code === "W1")!.state;
    expect(await at("19:00")).toBe("taken");
    expect(await at("17:45")).toBe("taken"); // 17:45 + 90 min overlaps 19:00
    expect(await at("17:30")).toBe("available"); // ends exactly at 19:00
    expect(await at("20:15")).toBe("taken");
    expect(await at("20:30")).toBe("available"); // the hold ends at 20:30
  });

  it("offers the 3 nearest times with a free table of a tier that is full", async () => {
    const date = day(10);
    for (const [i, code] of ["B1", "B2", "B3", "B4"].entries()) {
      await heldOk({ table: code, date, time: "19:00", party: 4, device: `booth-device-${i}-${date}` });
    }
    const res = await availability(date, "19:00", 4);
    expect(res.body.tables.filter((t) => t.code.startsWith("B")).every((t) => t.state === "taken")).toBe(true);
    const booth = res.body.alternatives.booth!;
    expect(booth.map((a) => a.time)).toEqual(["17:00", "21:00", "21:15"]);
    expect(booth[0]!.tables).toEqual(["B1", "B2", "B3", "B4"]);
    expect(booth[0]!.startsAt).toBe(zonedInstant(date, "17:00", LA)!.toISOString());
    // Tiers with free tables get no alternatives.
    expect(res.body.alternatives.terrace).toBeUndefined();
  });
});

describe("blackouts (O-4)", () => {
  it("a table blackout shows the table as taken and refuses a hold on it", async () => {
    const date = day(11);
    const from = zonedInstant(date, "18:00", LA)!;
    const to = zonedInstant(date, "22:00", LA)!;
    await db()
      .insert(blackout)
      .values({ venueId: "halcyon", tableId: await tableId("W3"), startsAt: from, endsAt: to, reason: "Private event" });
    const res = await availability(date, "19:00");
    expect(res.body.tables.find((t) => t.code === "W3")).toMatchObject({ state: "taken", reason: "Booked at this time." });
    expect(res.body.tables.find((t) => t.code === "W2")?.state).toBe("available");
    const attempt = await hold({ table: "W3", date, time: "19:00" });
    expect(attempt.status).toBe(409);
    expect(attempt.body.error).toMatchObject({ code: "taken", message: "Someone just took this table." });
    expect(attempt.body.error?.alternative).toMatchObject({ tier: "window" });
  });

  it("a venue-wide blackout makes every bookable table taken", async () => {
    const date = day(12);
    await db()
      .insert(blackout)
      .values({
        venueId: "halcyon",
        tableId: null,
        startsAt: zonedInstant(date, "17:00", LA)!,
        endsAt: zonedInstant(date, "23:59", LA)!,
        reason: "Closed",
      });
    const res = await availability(date, "19:00");
    const bookable = res.body.tables.filter((t) => t.state !== "not_bookable");
    expect(bookable.length).toBe(17);
    expect(bookable.every((t) => t.state === "taken")).toBe(true);
  });
});

describe("slots and table times", () => {
  it("lists bookable times with free tables per time", async () => {
    const date = day(13);
    const before = await call<SlotsResponse>(slotsGet, `/api/v/halcyon/slots?date=${date}&party=2`, {
      venue: "halcyon",
    });
    expect(before.status).toBe(200);
    const dinner = before.body.dayparts.find((d) => d.id === "dinner")!;
    expect(dinner.times[0]).toMatchObject({ time: "17:00" });
    expect(dinner.times.at(-1)).toMatchObject({ time: "21:45" });
    expect(dinner.times).toHaveLength(20);
    const free = dinner.times.find((t) => t.time === "19:00")!.freeTables;
    await heldOk({ table: "C1", date, time: "19:00" });
    const after = await call<SlotsResponse>(slotsGet, `/api/v/halcyon/slots?date=${date}&party=2`, {
      venue: "halcyon",
    });
    expect(after.body.dayparts.find((d) => d.id === "dinner")!.times.find((t) => t.time === "19:00")!.freeTables).toBe(free - 1);
  });

  it("finds the next free times for one table, across days (G-11)", async () => {
    const date = day(14);
    await heldOk({ table: "W6", date, time: "19:00" });
    const res = await call<TableTimesResponse>(timesGet, `/api/v/halcyon/tables/W6/times?date=${date}&time=17:00&party=2`, {
      venue: "halcyon",
      code: "W6",
    });
    expect(res.status).toBe(200);
    expect(res.body.times.map((t) => t.time)).toEqual(["17:00", "17:15", "17:30", "20:30", "20:45"]);
    const late = await call<TableTimesResponse>(
      timesGet,
      `/api/v/halcyon/tables/W6/times?date=${date}&time=21:30&party=2&limit=4`,
      { venue: "halcyon", code: "W6" },
    );
    expect(late.body.times).toHaveLength(4);
    expect(late.body.times.slice(0, 2).map((t) => `${t.date} ${t.time}`)).toEqual([`${date} 21:30`, `${date} 21:45`]);
    // Then the search carries on into the next day.
    expect(late.body.times[2]!.date).toBe(addDays(date, 1));
    const wrong = await call(timesGet, `/api/v/halcyon/tables/W6/times?date=${date}&time=17:00&party=4`, {
      venue: "halcyon",
      code: "W6",
    });
    expect(wrong.status).toBe(409);
  });
});

describe("abuse and switches", () => {
  it("scraping availability at a high rate gets 429 (red team)", async () => {
    const ip = nextIp();
    const date = day(15);
    let first429: Awaited<ReturnType<typeof availability>> | null = null;
    let ok = 0;
    for (let i = 0; i < 260 && !first429; i++) {
      const res = await availability(date, "19:00", 2, ip);
      if (res.status === 429) first429 = res;
      else ok++;
    }
    expect(first429).not.toBeNull();
    expect(ok).toBeGreaterThanOrEqual(120);
    expect(first429!.body.error?.code).toBe("rate_limited");
    expect(Number(first429!.headers.get("retry-after"))).toBeGreaterThan(0);
    // Another client is unaffected.
    expect((await availability(date, "19:00", 2, nextIp())).status).toBe(200);
  });

  it("the kill switch stops guest routes with a plain message, but never payment webhooks (S-5)", async () => {
    await setFlag(WIDGET_FLAG, false);
    try {
      const res = await availability(day(16), "19:00");
      expect(res.status).toBe(503);
      expect(res.body.error).toMatchObject({ code: "widget_disabled", message: "Online table selection is paused right now." });
      const h = await hold({ table: "W1", date: day(16), time: "19:00" });
      expect(h.status).toBe(503);
      const hook = await call(
        webhookPost,
        "/api/stripe/webhook",
        {},
        { body: "{}", headers: { "stripe-signature": "t=1,v1=bad" } },
      );
      expect(hook.status).toBe(400);
    } finally {
      await setFlag(WIDGET_FLAG, true);
    }
    expect((await availability(day(16), "19:00")).status).toBe(200);
  });

  it("a venue that is not live is not bookable by guests", async () => {
    await db().update(venue).set({ live: false }).where(eq(venue.id, "orchard-room"));
    try {
      const res = await availability(nextWeekday(3, 3, "America/New_York"), "19:00", 2, undefined, "orchard-room");
      expect(res.status).toBe(403);
      expect(res.body.error?.code).toBe("venue_not_live");
    } finally {
      await db().update(venue).set({ live: true }).where(eq(venue.id, "orchard-room"));
    }
    const live = await availability(nextWeekday(3, 3, "America/New_York"), "19:00", 2, undefined, "orchard-room");
    expect(live.status).toBe(200);
    expect(live.body.tables.find((t) => t.code === "G1")).toMatchObject({ state: "available", feeCents: 3000 });
  });
});
