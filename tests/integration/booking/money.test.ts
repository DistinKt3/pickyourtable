import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GET as reconcileRoute } from "@/app/api/jobs/reconcile/route";
import { GET as retentionRoute } from "@/app/api/jobs/retention/route";
import { GET as tickRoute } from "@/app/api/jobs/tick/route";
import { POST as cancelPost } from "@/app/api/manage/[token]/cancel/route";
import { db } from "@/db/client";
import { emailMessage, guest, reservation } from "@/db/schema";
import { reconcile, retention, tick } from "@/lib/booking/jobs";
import { cancelByVenue, markNoShow, seatReservation } from "@/lib/booking/operations";
import { resetEnvCache } from "@/lib/env";
import { type Booked, book, call, checkout, day, expireHold, heldOk, onTheNight, pay, resetBookingData, row } from "./helpers";

const owner = { type: "operator" as const, id: "00000000-0000-7000-8000-00000000b001" };

beforeAll(async () => {
  process.env.SIM_WEBHOOK_DELIVERY = "inline";
  await resetBookingData();
});

afterAll(() => {
  delete process.env.CRON_SECRET;
  resetEnvCache();
});

describe("money reconciles to the cent (PRD gate)", () => {
  it("20 bookings, cancellations, refunds and expired holds match the provider exactly", async () => {
    const tables = ["W1", "W2", "W3", "W4", "W5", "W6", "B1", "B2", "B3", "B4", "C1", "C2", "C3", "T1", "T2", "T3", "T4"];
    const booked: Booked[] = [];
    for (let i = 0; i < 20; i++) {
      const table = tables[i % tables.length]!;
      booked.push(await book({ table, date: day(20 + Math.floor(i / tables.length)), time: "19:00", party: 2 }));
    }
    const paidTotal = booked.reduce((s, b) => s + b.priceCents, 0);

    // Guest cancellations with a full refund.
    for (const b of booked.slice(0, 4)) {
      const res = await call<{ refundCents: number }>(
        cancelPost,
        `/api/manage/${b.manageToken}/cancel`,
        { token: b.manageToken },
        { method: "POST" },
      );
      expect(res.body.refundCents).toBe(b.priceCents);
    }
    // A guest cancellation under 24 hours: no refund.
    await db().execute(
      sql`UPDATE reservation SET starts_at = now() + interval '20 hours', ends_at = now() + interval '21 hours 30 minutes' WHERE id = ${booked[4]!.holdId}`,
    );
    const none = await call<{ refundCents: number }>(
      cancelPost,
      `/api/manage/${booked[4]!.manageToken}/cancel`,
      { token: booked[4]!.manageToken },
      { method: "POST" },
    );
    expect(none.body.refundCents).toBe(0);
    // Venue cancellations, seated elsewhere, a seated guest and no-shows.
    await cancelByVenue({ venueId: "halcyon", reservationId: booked[5]!.holdId, reason: "Private event", actor: owner });
    await cancelByVenue({ venueId: "halcyon", reservationId: booked[6]!.holdId, reason: "Private event", actor: owner });
    await onTheNight(booked[7]!.holdId, () =>
      seatReservation({ venueId: "halcyon", reservationId: booked[7]!.holdId, tableCode: "S3", actor: owner }),
    );
    await onTheNight(booked[8]!.holdId, () =>
      seatReservation({ venueId: "halcyon", reservationId: booked[8]!.holdId, actor: owner }),
    );
    await onTheNight(
      booked[9]!.holdId,
      () => markNoShow({ venueId: "halcyon", reservationId: booked[9]!.holdId, actor: owner }),
      20,
    );
    await onTheNight(
      booked[10]!.holdId,
      () => markNoShow({ venueId: "halcyon", reservationId: booked[10]!.holdId, actor: owner }),
      20,
    );

    // Expired holds: one never paid, one with an open payment the job cancels, one paid late and refunded.
    const date = day(25);
    await expireHold((await heldOk({ table: "W1", date, time: "19:00" })).hold.id);
    const open = await heldOk({ table: "W2", date, time: "19:00" });
    await checkout(open.hold.id, open.holdToken);
    await expireHold(open.hold.id);
    const late = await heldOk({ table: "W3", date, time: "19:00" });
    const lateCheckout = await checkout(late.hold.id, late.holdToken);
    await expireHold(late.hold.id);
    await heldOk({ table: "W3", date, time: "19:00" });
    await pay(lateCheckout.body.payment.paymentIntentId, lateCheckout.body.payment.clientSecret);
    // A declined payment on a hold that is still open.
    const declined = await heldOk({ table: "W4", date, time: "19:00" });
    const dc = await checkout(declined.hold.id, declined.holdToken);
    await pay(dc.body.payment.paymentIntentId, dc.body.payment.clientSecret, "card_declined");
    await tick();
    expect((await row(open.hold.id)).paymentIntentCanceledAt).not.toBeNull();
    expect((await row(late.hold.id)).refundCents).toBe(late.hold.priceCents);

    const refundedExpected =
      booked.slice(0, 4).reduce((s, b) => s + b.priceCents, 0) +
      booked[5]!.priceCents +
      booked[6]!.priceCents +
      booked[7]!.priceCents +
      late.hold.priceCents;

    const report = await reconcile();
    expect(report.mismatches).toEqual([]);
    expect(report.chargedCents).toBe(paidTotal + late.hold.priceCents);
    expect(report.refundedCents).toBe(refundedExpected);
    expect(report.netCents).toBe(paidTotal + late.hold.priceCents - refundedExpected);
    expect(report.checked).toBe(23);

    // Reconciliation notices when the books and the provider disagree.
    await db().update(reservation).set({ refundCents: 0, refundDueCents: 0 }).where(eq(reservation.id, booked[0]!.holdId));
    const broken = await reconcile();
    expect(broken.mismatches).toEqual([
      expect.objectContaining({
        reservationId: booked[0]!.holdId,
        kind: "refund_amount",
        expected: 0,
        actual: booked[0]!.priceCents,
      }),
    ]);
    await db()
      .update(reservation)
      .set({ refundCents: booked[0]!.priceCents, refundDueCents: booked[0]!.priceCents })
      .where(eq(reservation.id, booked[0]!.holdId));
    expect((await reconcile()).mismatches).toEqual([]);
  });

  it("a refund the provider could not take is retried by the job until it lands", async () => {
    const b = await book({ table: "C3", date: day(26), time: "19:00" });
    // Owed but not yet requested, as after a provider outage.
    await db()
      .update(reservation)
      .set({ status: "cancelled", cancelReason: "venue", refundDueCents: b.priceCents })
      .where(eq(reservation.id, b.holdId));
    const pending = await reconcile();
    expect(pending.mismatches).toEqual([expect.objectContaining({ reservationId: b.holdId, kind: "refund_pending" })]);
    const report = await tick();
    expect(report.refundsSettled).toBe(1);
    expect((await row(b.holdId)).refundCents).toBe(b.priceCents);
    expect((await reconcile()).mismatches).toEqual([]);
  });
});

describe("retention", () => {
  it("deletes guest data 24 months after the visit and keeps the amounts", async () => {
    const old = await book({ table: "T1", date: day(27), time: "19:00", email: "long.ago@example.com" });
    const recent = await book({ table: "T2", date: day(27), time: "19:00", email: "recent@example.com" });
    await db().execute(sql`
      UPDATE reservation SET starts_at = now() - interval '25 months', ends_at = now() - interval '25 months' + interval '90 minutes'
       WHERE id = ${old.holdId}
    `);
    const oldGuest = (await row(old.holdId)).guestId!;
    const report = await retention();
    expect(report).toMatchObject({ reservationsScrubbed: 1, guestsDeleted: 1 });
    expect(report.emailsDeleted).toBeGreaterThanOrEqual(2);
    const r = await row(old.holdId);
    expect(r).toMatchObject({ guestId: null, emailNorm: null, priceCents: old.priceCents, status: "confirmed" });
    expect(await db().select().from(guest).where(eq(guest.id, oldGuest))).toHaveLength(0);
    expect(await db().select().from(emailMessage).where(eq(emailMessage.reservationId, old.holdId))).toHaveLength(0);
    expect((await row(recent.holdId)).guestId).not.toBeNull();
    expect((await retention()).reservationsScrubbed).toBe(0);
  });
});

describe("job endpoints", () => {
  it("require the cron secret", async () => {
    delete process.env.CRON_SECRET;
    resetEnvCache();
    expect((await call(tickRoute, "/api/jobs/tick", {})).status).toBe(401);
    process.env.CRON_SECRET = "cron-secret-for-tests-0123456789";
    resetEnvCache();
    expect((await call(tickRoute, "/api/jobs/tick", {}, { headers: { authorization: "Bearer wrong" } })).status).toBe(401);
    expect(
      (await call(tickRoute, "/api/jobs/tick", {}, { headers: { authorization: "cron-secret-for-tests-0123456789" } })).status,
    ).toBe(401);
    const auth = { authorization: "Bearer cron-secret-for-tests-0123456789" };
    const ok = await call<{ expired: number }>(tickRoute, "/api/jobs/tick", {}, { headers: auth });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ expired: expect.any(Number), refundsSettled: expect.any(Number) });
    const rec = await call<{ mismatches: unknown[] }>(reconcileRoute, "/api/jobs/reconcile", {}, { headers: auth });
    expect(rec.status).toBe(200);
    expect(rec.body.mismatches).toEqual([]);
    expect((await call(retentionRoute, "/api/jobs/retention", {}, { headers: auth })).status).toBe(200);
  });
});
