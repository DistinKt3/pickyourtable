import { and, desc, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { DELETE as deleteRoute } from "@/app/api/portal/blackouts/[id]/route";
import { GET as overlapsRoute } from "@/app/api/portal/blackouts/overlaps/route";
import { GET as listRoute, POST as createRoute } from "@/app/api/portal/blackouts/route";
import { db } from "@/db/client";
import { auditLog, blackout } from "@/db/schema";
import type { BlackoutView } from "@/lib/api/contracts";
import { addDays, isoWeekday, todayIn } from "@/lib/format";
import { seedBookings } from "@/lib/portal/dev-fixtures";
import type { CreateBlackoutResponse, OverlapsResponse } from "@/lib/portal/schemas";
import { call, errorCode, HALCYON_OWNER, ORCHARD_OWNER, request, signIn } from "./helpers";

let owner: string;
let orchardOwner: string;
const today = todayIn("America/Los_Angeles");

/** The next first Sunday of November (the US clock change) that is still ahead. */
function nextFallBack(): string {
  for (let year = Number(today.slice(0, 4)); ; year++) {
    let d = `${year}-11-01`;
    while (isoWeekday(d) !== 7) d = addDays(d, 1);
    if (addDays(d, -1) > today) return d;
  }
}

const create = (cookie: string, body: unknown) =>
  call<CreateBlackoutResponse>(createRoute, request("POST", "/api/portal/blackouts", { cookie, body }));

beforeAll(async () => {
  [owner, orchardOwner] = await Promise.all([signIn(HALCYON_OWNER), signIn(ORCHARD_OWNER)]);
});

describe("blackouts (O-4)", () => {
  it("converts the venue's local times to UTC instants on both sides of the November clock change", async () => {
    const sunday = nextFallBack();
    // This year the change is on 2026-11-01, so the "after" date below is 2026-11-02.
    expect(today >= "2026-10-31" || sunday === "2026-11-01").toBe(true);
    const saturday = addDays(sunday, -1);
    const monday = addDays(sunday, 1);

    const before = await create(owner, { table: "W1", date: saturday, from: "17:00", to: "22:00", reason: "Private dinner" });
    expect(before.status).toBe(201);
    // Pacific Daylight Time, UTC-7.
    expect(before.body.blackout).toMatchObject({
      table: "W1",
      tableLabel: "Window 1",
      date: saturday,
      from: "17:00",
      to: "22:00",
      startsAt: `${sunday}T00:00:00.000Z`,
      endsAt: `${sunday}T05:00:00.000Z`,
    });

    const after = await create(owner, { table: "W1", date: monday, from: "17:00", to: "22:00", reason: "Private dinner" });
    // Pacific Standard Time, UTC-8.
    expect(after.body.blackout).toMatchObject({
      date: monday,
      from: "17:00",
      to: "22:00",
      startsAt: `${addDays(monday, 1)}T01:00:00.000Z`,
      endsAt: `${addDays(monday, 1)}T06:00:00.000Z`,
    });

    // The clock-change day itself is 25 hours long; "all day" ends at the next local midnight.
    const allDay = await create(owner, { table: null, date: sunday, from: "00:00", to: "23:59", reason: "Staff training" });
    expect(allDay.body.blackout).toMatchObject({
      table: null,
      tableLabel: null,
      date: sunday,
      from: "00:00",
      to: "23:59",
      startsAt: `${sunday}T07:00:00.000Z`,
      endsAt: `${monday}T08:00:00.000Z`,
    });

    // Another venue converts in its own time zone (Eastern Standard Time, UTC-5).
    const orchard = await create(orchardOwner, {
      table: "G1",
      date: monday,
      from: "17:30",
      to: "19:00",
      reason: "Garden lights repair",
    });
    expect(orchard.body.blackout).toMatchObject({
      startsAt: `${monday}T22:30:00.000Z`,
      endsAt: `${addDays(monday, 1)}T00:00:00.000Z`,
    });

    const [row] = await db().select().from(blackout).where(eq(blackout.id, after.body.blackout.id));
    expect(row?.startsAt.toISOString()).toBe(`${addDays(monday, 1)}T01:00:00.000Z`);
    expect(row?.venueId).toBe("halcyon");
  });

  it("warns about confirmed bookings in the range without blocking the blackout", async () => {
    const date = addDays(today, 9);
    const [inRange, otherTable] = await seedBookings("halcyon", date, [
      { table: "W3", time: "19:00", party: 2, name: "Iris Calloway" },
      { table: "W4", time: "19:00", party: 2, name: "Theo Brandt" },
    ]);
    await seedBookings("halcyon", date, [{ table: "W3", time: "21:00", party: 2, name: "Rosa Lind", status: "cancelled" }]);

    const preview = await call<OverlapsResponse>(
      overlapsRoute,
      request("GET", `/api/portal/blackouts/overlaps?table=W3&date=${date}&from=18:00&to=20:00`, { cookie: owner }),
    );
    expect(preview.status).toBe(200);
    expect(preview.body.overlapping).toEqual([
      expect.objectContaining({
        id: inRange,
        table: "W3",
        tableLabel: "Window 3",
        date,
        time: "19:00",
        guestName: "Iris Calloway",
      }),
    ]);

    const r = await create(owner, { table: "W3", date, from: "18:00", to: "20:00", reason: "Photo shoot" });
    expect(r.status).toBe(201);
    expect(r.body.overlapping.map((b) => b.id)).toEqual([inRange]);
    expect(r.body.overlapping[0]).toMatchObject({ partySize: 2, priceCents: expect.any(Number) });

    // A cancelled booking does not count; the venue-wide range catches both tables.
    const venueWide = await create(owner, { table: null, date, from: "18:30", to: "23:59", reason: "Power outage" });
    expect(new Set(venueWide.body.overlapping.map((b) => b.id))).toEqual(new Set([inRange, otherTable]));

    const audit = await db()
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.venueId, "halcyon"), eq(auditLog.action, "blackout.created")))
      .orderBy(desc(auditLog.id))
      .limit(1);
    expect(audit[0]?.details).toMatchObject({
      table: null,
      date,
      reason: "Power outage",
      overlappingBookings: expect.arrayContaining([inRange]),
    });
  });

  it("lists upcoming blackouts and deletes one with an audit row", async () => {
    const date = addDays(today, 12);
    const made = await create(owner, { table: "B2", date, from: "11:30", to: "14:30", reason: "Booth reupholstery" });
    const id = made.body.blackout.id;

    const list = await call<{ blackouts: BlackoutView[] }>(listRoute, request("GET", "/api/portal/blackouts", { cookie: owner }));
    expect(list.body.blackouts.find((b) => b.id === id)).toMatchObject({ table: "B2", date, from: "11:30", to: "14:30" });
    const starts = list.body.blackouts.map((b) => b.startsAt);
    expect(starts).toEqual([...starts].sort());

    const del = await call(deleteRoute, request("DELETE", `/api/portal/blackouts/${id}`, { cookie: owner }), { id });
    expect(del.status).toBe(200);
    expect(await db().select().from(blackout).where(eq(blackout.id, id))).toHaveLength(0);
    const [audit] = await db()
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.venueId, "halcyon"), eq(auditLog.action, "blackout.deleted")))
      .orderBy(desc(auditLog.id))
      .limit(1);
    expect(audit?.details).toMatchObject({
      blackout: id,
      table: "B2",
      date,
      from: "11:30",
      to: "14:30",
      reason: "Booth reupholstery",
    });

    const again = await call(deleteRoute, request("DELETE", `/api/portal/blackouts/${id}`, { cookie: owner }), { id });
    expect(again.status).toBe(404);
  });

  it("validates the range, the table and the reason", async () => {
    const date = addDays(today, 3);
    expect((await create(owner, { table: "W1", date, from: "20:00", to: "19:00", reason: "Backwards" })).status).toBe(400);
    expect((await create(owner, { table: "W1", date, from: "19:00", to: "20:00", reason: "" })).status).toBe(400);
    expect(
      (await create(owner, { table: "W1", date: "2026-02-30x", from: "19:00", to: "20:00", reason: "Bad date" })).status,
    ).toBe(400);
    expect((await create(owner, { table: "Z9", date, from: "19:00", to: "20:00", reason: "No such table" })).status).toBe(404);
    const past = await create(owner, { table: "W1", date: addDays(today, -2), from: "19:00", to: "20:00", reason: "Too late" });
    expect(errorCode(past)).toBe("in_the_past");
  });
});
