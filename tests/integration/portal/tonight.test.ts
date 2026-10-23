import { and, eq, like } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { GET as tonightRoute } from "@/app/api/portal/tonight/route";
import { db } from "@/db/client";
import { reservation } from "@/db/schema";
import type { TonightResponse } from "@/lib/api/contracts";
import { listTonight, OperationError } from "@/lib/booking/operations";
import { addDays, todayIn } from "@/lib/format";
import { FIXTURE_PAYMENT_PREFIX, fixtureBookings, fixtureTonight, seedFixtureReservations } from "@/lib/portal/dev-fixtures";
import { localToUtc } from "@/lib/portal/time";
import { call, HALCYON_HOST, request, signIn } from "./helpers";

/**
 * Tonight with real paid bookings in the database. The fixture rows must satisfy the
 * schema (including the no-overlap constraint). Once the booking service implements
 * `listTonight`, the route test below proves those bookings reach Tonight with a PAID
 * badge; until then the operation answers 501 and that test is reported as skipped.
 */

const tz = "America/Los_Angeles";
const date = addDays(todayIn(tz), 20);

const implemented = await listTonight({ venueId: "halcyon", date }).then(
  () => true,
  (e: unknown) => !(e instanceof OperationError && e.status === 501),
);

describe("Tonight fixtures", () => {
  it("seed a realistic service that satisfies every database constraint", async () => {
    const { ids } = await seedFixtureReservations("halcyon", date);
    expect(ids.length).toBeGreaterThanOrEqual(20);
    const rows = await db()
      .select()
      .from(reservation)
      .where(and(eq(reservation.venueId, "halcyon"), like(reservation.paymentIntentId, `${FIXTURE_PAYMENT_PREFIX}%`)));
    expect(rows).toHaveLength(ids.length);
    expect(rows.every((r) => r.priceCents > 0 && r.cardBrand && r.cardLast4?.length === 4)).toBe(true);
    // Seeding again replaces the rows instead of colliding with the no-overlap constraint.
    const again = await seedFixtureReservations("halcyon", date);
    expect(again.ids).toHaveLength(ids.length);
  });

  it("build the Tonight read model used by the screenshot script", async () => {
    const now = localToUtc(date, "19:45", tz);
    const t = await fixtureTonight("halcyon", date, now);
    expect(t.date).toBe(date);
    const times = t.reservations.map((r) => r.slot.startsAt);
    expect(times).toEqual([...times].sort());
    expect(t.reservations.every((r) => r.slot.date === date && r.paid)).toBe(true);
    const marchetti = t.reservations.find((r) => r.guestName === "Elena Marchetti");
    expect(marchetti).toMatchObject({ table: "W1", status: "confirmed", slot: { time: "19:30", dayType: expect.any(String) } });
    const ferreira = t.reservations.find((r) => r.guestName === "Ana Ferreira");
    expect(ferreira).toMatchObject({ table: "W5", seatedTable: "S2", refundCents: ferreira?.priceCents });
    expect(t.tables.find((x) => x.code === "W1")?.state).toBe("paid");
    expect(t.tables.find((x) => x.code === "B1")?.state).toBe("seated");
    expect(t.tables.find((x) => x.code === "S2")?.state).toBe("seated");

    const upcoming = await fixtureBookings("halcyon", { status: "upcoming" }, now);
    expect(upcoming.bookings.every((b) => b.status === "confirmed")).toBe(true);
    const search = await fixtureBookings("halcyon", { status: "all", q: "marchetti" }, now);
    expect(search.bookings.map((b) => b.guestName)).toEqual(["Elena Marchetti"]);
  });
});

describe.runIf(implemented)("Tonight route with the booking service", () => {
  it("shows every paid booking for the date with a PAID badge and the table states", async () => {
    await seedFixtureReservations("halcyon", date);
    const cookie = await signIn(HALCYON_HOST);
    const r = await call<TonightResponse>(tonightRoute, request("GET", `/api/portal/tonight?date=${date}`, { cookie }));
    expect(r.status).toBe(200);
    const paid = r.body.reservations.filter((x) => x.status === "confirmed" || x.status === "seated");
    expect(paid.length).toBeGreaterThanOrEqual(9);
    expect(paid.every((x) => x.paid && x.priceCents > 0)).toBe(true);
    expect(r.body.reservations.map((x) => x.guestName)).toContain("Elena Marchetti");
    expect(r.body.tables.length).toBe(25);
  });
});
