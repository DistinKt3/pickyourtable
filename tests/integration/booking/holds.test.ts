import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DELETE as holdDelete } from "@/app/api/holds/[id]/route";
import { GET as availabilityGet } from "@/app/api/v/[venue]/availability/route";
import { db, pgCode, PG } from "@/db/client";
import { priceRule, reservation, simPaymentIntent } from "@/db/schema";
import type { AvailabilityResponse } from "@/lib/api/contracts";
import { tick } from "@/lib/booking/jobs";
import { zonedInstant } from "@/lib/booking/time";
import { resetEnvCache } from "@/lib/env";
import { signToken } from "@/lib/security/tokens";
import {
  call,
  checkout,
  day,
  expireHold,
  heldOk,
  hold,
  holdStatus,
  LA,
  nextDevice,
  nextEmail,
  nextIp,
  nextWeekday,
  resetBookingData,
  row,
} from "./helpers";

beforeAll(async () => {
  process.env.SIM_WEBHOOK_DELIVERY = "inline";
  await resetBookingData();
});

afterAll(() => {
  process.env.TURNSTILE_SECRET_KEY = "1x0000000000000000000000000000000AA";
  resetEnvCache();
});

async function overlaps(): Promise<number> {
  const res = await db().execute<{ n: number }>(sql`
    SELECT count(*)::int AS n FROM reservation a JOIN reservation b
      ON a.table_id = b.table_id AND a.id < b.id AND a.during && b.during
     WHERE a.status IN ('held', 'confirmed', 'seated') AND b.status IN ('held', 'confirmed', 'seated')
  `);
  return res.rows[0]!.n;
}

describe("the race for one table (G-6, PRD gate: 20 races, 20 single winners, 0 double bookings)", () => {
  it("20 rounds of 10 concurrent holds: exactly one wins each round, the rest get the most similar table", async () => {
    const winners: string[] = [];
    for (let round = 0; round < 20; round++) {
      const date = day(3 + round);
      const results = await Promise.all(
        Array.from({ length: 10 }, () => hold({ table: "W2", date, time: "19:00", ip: nextIp(), device: nextDevice() })),
      );
      const won = results.filter((r) => r.status === 201);
      const lost = results.filter((r) => r.status === 409);
      const seen = results.map((r) => `${r.status}${r.body.error ? `:${r.body.error.code}` : ""}`).join(", ");
      expect(won, `round ${round}: ${seen}`).toHaveLength(1);
      expect(lost, `round ${round}: ${seen}`).toHaveLength(9);
      for (const l of lost) {
        expect(l.body.error).toMatchObject({ code: "taken", message: "Someone just took this table." });
        // Same tier, then the most shared attributes: Window 5 is also on the water and wheelchair accessible.
        expect(l.body.error?.alternative).toEqual({
          code: "W5",
          label: "Window 5",
          tier: "window",
          feeCents: expect.any(Number),
        });
      }
      winners.push(won[0]!.body.hold.id);
    }
    expect(new Set(winners).size).toBe(20);
    expect(await overlaps()).toBe(0);
    const held = await db()
      .select({ id: reservation.id })
      .from(reservation)
      .where(and(eq(reservation.status, "held")));
    expect(held.length).toBe(20);
  });

  it("the database itself refuses an overlapping booking (S-2)", async () => {
    const date = day(4);
    const h = await heldOk({ table: "W5", date, time: "19:00" });
    const r = await row(h.hold.id);
    const start = new Date(r.startsAt.getTime() + 30 * 60_000);
    let code: string | undefined;
    try {
      await db()
        .insert(reservation)
        .values({
          venueId: "halcyon",
          tableId: r.tableId,
          partySize: 2,
          startsAt: start,
          endsAt: new Date(start.getTime() + 90 * 60_000),
          daypart: "dinner",
          dayType: "weeknight",
          status: "confirmed",
          priceCents: 2500,
          applicationFeeCents: 750,
          deviceHash: "direct-sql",
          ipHash: "direct-sql",
          manageNonce: "direct-sql",
        });
    } catch (e) {
      code = pgCode(e);
    }
    expect(code).toBe(PG.exclusionViolation);
    expect(await overlaps()).toBe(0);
  });
});

describe("hold lifecycle", () => {
  it("returns a hold with the server price, an 8-minute expiry and a token", async () => {
    const wed = nextWeekday(3, 3);
    const h = await heldOk({ table: "T1", date: wed, time: "18:30", party: 3 });
    expect(h.hold).toMatchObject({
      table: "T1",
      tableLabel: "Terrace 1",
      tier: "terrace",
      partySize: 3,
      priceCents: 2000,
      status: "held",
    });
    const ms = new Date(h.hold.expiresAt).getTime() - Date.now();
    expect(ms).toBeGreaterThan(7.5 * 60_000);
    expect(ms).toBeLessThanOrEqual(8 * 60_000 + 1000);
    expect(new Date(h.hold.slot.endsAt).getTime() - new Date(h.hold.slot.startsAt).getTime()).toBe(120 * 60_000);
    const r = await row(h.hold.id);
    expect(r.applicationFeeCents).toBe(600);
  });

  it("refuses wrong sizes, unknown and host-seated tables", async () => {
    const date = day(30);
    const big = await hold({ table: "W1", date, time: "19:00", party: 4 });
    expect(big.status).toBe(409);
    expect(big.body.error).toMatchObject({ code: "wrong_size", message: "Seats 2. Your party is 4." });
    expect((await hold({ table: "S1", date, time: "19:00" })).body.error?.code).toBe("not_bookable");
    expect((await hold({ table: "Z9", date, time: "19:00" })).status).toBe(404);
    const huge = await hold({ table: "B1", date, time: "19:00", party: 8 });
    expect(huge.body.error).toMatchObject({ code: "party_too_large" });
  });

  it("an expired hold no longer blocks, and the job expires it", async () => {
    const date = day(31);
    const first = await heldOk({ table: "C2", date, time: "19:00" });
    await expireHold(first.hold.id);
    // Guests see the table free as soon as the hold runs out, before any job runs.
    const avail = await call<AvailabilityResponse>(
      availabilityGet,
      `/api/v/halcyon/availability?date=${date}&time=19:00&party=2`,
      { venue: "halcyon" },
    );
    expect(avail.body.tables.find((t) => t.code === "C2")?.state).toBe("available");
    const status = await holdStatus(first.hold.id, first.holdToken);
    expect(status.body.hold.status).toBe("expired");
    // Holding it again expires the stale hold in the same transaction.
    const second = await heldOk({ table: "C2", date, time: "19:00" });
    expect((await row(first.hold.id)).status).toBe("expired");
    expect((await row(second.hold.id)).status).toBe("held");

    // The 30-second job expires holds nobody re-held, and cancels their payment.
    const third = await heldOk({ table: "C3", date, time: "19:00" });
    const c = await checkout(third.hold.id, third.holdToken);
    expect(c.status).toBe(200);
    await expireHold(third.hold.id);
    const report = await tick();
    expect(report.expired).toBeGreaterThanOrEqual(1);
    expect(report.intentsClosed).toBeGreaterThanOrEqual(1);
    const r = await row(third.hold.id);
    expect(r.status).toBe("expired");
    expect(r.cancelReason).toBe("expired");
    expect(r.paymentIntentCanceledAt).not.toBeNull();
    const [pi] = await db().select().from(simPaymentIntent).where(eq(simPaymentIntent.id, c.body.payment.paymentIntentId));
    expect(pi!.status).toBe("canceled");
    // Checkout on an expired hold is refused.
    const late = await checkout(third.hold.id, third.holdToken);
    expect(late.status).toBe(409);
    expect(late.body.error?.code).toBe("hold_expired");
  });

  it("releasing a hold frees the table and cancels its unpaid payment", async () => {
    const date = day(32);
    const h = await heldOk({ table: "T2", date, time: "19:00" });
    const c = await checkout(h.hold.id, h.holdToken);
    const res = await call<{ hold: { status: string } }>(
      holdDelete,
      `/api/holds/${h.hold.id}`,
      { id: h.hold.id },
      {
        method: "DELETE",
        token: h.holdToken,
      },
    );
    expect(res.status).toBe(200);
    expect(res.body.hold.status).toBe("expired");
    const r = await row(h.hold.id);
    expect(r.cancelReason).toBe("released");
    const [pi] = await db().select().from(simPaymentIntent).where(eq(simPaymentIntent.id, c.body.payment.paymentIntentId));
    expect(pi!.status).toBe("canceled");
    await heldOk({ table: "T2", date, time: "19:00" });
  });

  it("only the hold's own token can read or release it", async () => {
    const date = day(33);
    const a = await heldOk({ table: "W4", date, time: "19:00" });
    const b = await heldOk({ table: "W5", date, time: "19:00" });
    expect((await holdStatus(a.hold.id, b.holdToken)).status).toBe(401);
    const manageShaped = await signToken("manage", { sub: a.hold.id, nonce: "x", expiresAt: new Date(Date.now() + 60_000) });
    expect((await holdStatus(a.hold.id, manageShaped)).status).toBe(401);
    const expired = await signToken("hold", { sub: a.hold.id, expiresAt: new Date(Date.now() - 1000) });
    expect((await holdStatus(a.hold.id, expired)).status).toBe(401);
    const del = await call(holdDelete, `/api/holds/${a.hold.id}`, { id: a.hold.id }, { method: "DELETE", token: b.holdToken });
    expect(del.status).toBe(401);
    expect((await row(a.hold.id)).status).toBe("held");
  });
});

describe("fees and the server price (O-3, S-1)", () => {
  it("a fee change applies to new holds only", async () => {
    const wed = nextWeekday(3, 10);
    const old = await heldOk({ table: "W1", date: wed, time: "20:00" });
    expect(old.hold.priceCents).toBe(2500);
    const rule = and(
      eq(priceRule.venueId, "halcyon"),
      eq(priceRule.tier, "window"),
      eq(priceRule.daypart, "dinner"),
      eq(priceRule.dayType, "weeknight"),
    );
    await db().update(priceRule).set({ feeCents: 2700 }).where(rule);
    try {
      const fresh = await heldOk({ table: "W3", date: wed, time: "20:00" });
      expect(fresh.hold.priceCents).toBe(2700);
      expect((await row(fresh.hold.id)).applicationFeeCents).toBe(810);
      const status = await holdStatus(old.hold.id, old.holdToken);
      expect(status.body.hold.priceCents).toBe(2500);
      const c = await checkout(old.hold.id, old.holdToken);
      expect(c.body.payment.amountCents).toBe(2500);
    } finally {
      await db().update(priceRule).set({ feeCents: 2500 }).where(rule);
    }
  });

  it("price-like fields from the client are ignored; the charge is the server price (S-1)", async () => {
    const fri = nextWeekday(5, 10);
    const h = await heldOk({ table: "W6", date: fri, time: "20:00", extra: { priceCents: 1, feeCents: 1, amount: 1 } });
    expect(h.hold.priceCents).toBe(4000);
    const c = await checkout(h.hold.id, h.holdToken, nextEmail(), {
      amount: 50,
      amountCents: 50,
      priceCents: 50,
      currency: "eur",
    });
    expect(c.status).toBe(200);
    expect(c.body.payment).toMatchObject({ mode: "sim", amountCents: 4000, currency: "usd", publishableKey: null });
    const [pi] = await db().select().from(simPaymentIntent).where(eq(simPaymentIntent.id, c.body.payment.paymentIntentId));
    expect(pi).toMatchObject({ amount: 4000, applicationFeeAmount: 1200, destination: "acct_sim_halcyon", currency: "usd" });
    expect(pi!.metadata).toMatchObject({ reservation_id: h.hold.id, venue_id: "halcyon", table: "W6" });
    // Checking out again reuses the same payment for the same amount.
    const again = await checkout(h.hold.id, h.holdToken);
    expect(again.body.payment.paymentIntentId).toBe(c.body.payment.paymentIntentId);
  });
});

describe("abuse limits (S-4)", () => {
  it("a bot holding every premium table from one device is stopped after 2", async () => {
    const date = day(40);
    const device = nextDevice();
    const codes = ["W1", "W2", "W3", "W4", "W5", "W6"];
    const results = [];
    for (const table of codes) results.push(await hold({ table, date, time: "19:00", device, ip: nextIp() }));
    expect(results.map((r) => r.status)).toEqual([201, 201, 429, 429, 429, 429]);
    expect(results[2]!.body.error).toMatchObject({
      code: "hold_limit",
      message: "You already have 2 tables on hold. Finish booking one, or release it, to hold another.",
    });
  });

  it("concurrent holds from one device cannot pass the limit together", async () => {
    const date = day(41);
    const device = nextDevice();
    const results = await Promise.all(["B1", "B2", "B3", "B4"].map((table) => hold({ table, date, time: "19:00", device })));
    expect(results.filter((r) => r.status === 201)).toHaveLength(2);
    expect(results.filter((r) => r.status === 429)).toHaveLength(2);
  });

  it("one IP rotating devices is rate limited", async () => {
    const date = day(42);
    const ip = nextIp();
    const statuses: number[] = [];
    const tables = ["W1", "W2", "W3", "W4", "W5", "W6", "C1", "C2", "C3", "T1", "T2", "T3", "T4"];
    for (const table of tables) statuses.push((await hold({ table, date, time: "19:00", ip, party: 2 })).status);
    expect(statuses.slice(0, 12).every((s) => s === 201)).toBe(true);
    expect(statuses[12]).toBe(429);
  });

  it("at most 2 active holds per email", async () => {
    const date = day(43);
    const email = nextEmail();
    const holds = [];
    for (const table of ["W1", "W2", "W3"]) holds.push(await heldOk({ table, date, time: "20:00" }));
    expect((await checkout(holds[0]!.hold.id, holds[0]!.holdToken, email)).status).toBe(200);
    expect((await checkout(holds[1]!.hold.id, holds[1]!.holdToken, email.toUpperCase())).status).toBe(200);
    const third = await checkout(holds[2]!.hold.id, holds[2]!.holdToken, ` ${email} `.trim());
    expect(third.status).toBe(429);
    expect(third.body.error?.code).toBe("hold_limit");
  });

  it("a hold without a Turnstile token, or with a failed check, is refused", async () => {
    const date = day(44);
    const missing = await hold({ table: "W1", date, time: "19:00", turnstileToken: null });
    expect(missing.status).toBe(400);
    process.env.TURNSTILE_SECRET_KEY = "2x0000000000000000000000000000000AA";
    resetEnvCache();
    try {
      const failed = await hold({ table: "W1", date, time: "19:00" });
      expect(failed.status).toBe(403);
      expect(failed.body.error?.code).toBe("turnstile_failed");
    } finally {
      process.env.TURNSTILE_SECRET_KEY = "1x0000000000000000000000000000000AA";
      resetEnvCache();
    }
    expect((await hold({ table: "W1", date, time: "19:00" })).status).toBe(201);
  });

  it("refuses cross-site hold requests", async () => {
    const res = await call(
      (await import("@/app/api/v/[venue]/holds/route")).POST,
      "/api/v/halcyon/holds",
      { venue: "halcyon" },
      {
        body: { table: "W1", date: day(45), time: "19:00", party: 2, turnstileToken: "x" },
        headers: { origin: "https://evil.example" },
      },
    );
    expect(res.status).toBe(403);
  });
});

describe("time zones", () => {
  it("holds store UTC instants for the venue's wall clock on both sides of the clock change", async () => {
    // Fall back is 2026-11-01 in Los Angeles; only check when the dates are still bookable.
    for (const date of ["2026-10-31", "2026-11-01"]) {
      if (date < day(1) || date > day(60)) continue;
      const h = await heldOk({ table: "T3", date, time: "17:00", party: 2 });
      expect(h.hold.slot.startsAt).toBe(zonedInstant(date, "17:00", LA)!.toISOString());
    }
  });
});

describe("heavy contention", () => {
  it("150 simultaneous holds across 5 tables: one winner per table, every loser told it was taken", async () => {
    await resetBookingData();
    const date = day(40);
    const tables = ["W1", "W2", "W3", "W4", "W6"];
    const results = await Promise.all(
      tables.flatMap((table) =>
        Array.from({ length: 30 }, async () => ({
          table,
          res: await hold({ table, date, time: "20:00", ip: nextIp(), device: nextDevice() }),
        })),
      ),
    );
    for (const table of tables) {
      const mine = results.filter((r) => r.table === table).map((r) => r.res);
      const seen = mine.map((r) => `${r.status}${r.body.error ? `:${r.body.error.code}` : ""}`).join(", ");
      expect(
        mine.filter((r) => r.status === 201),
        `${table}: ${seen}`,
      ).toHaveLength(1);
      expect(
        mine.filter((r) => r.status === 409 && r.body.error?.code === "taken"),
        `${table}: ${seen}`,
      ).toHaveLength(29);
    }
    expect(await overlaps()).toBe(0);
    await resetBookingData();
  });
});
