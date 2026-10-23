import { eq, sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { GET as calendarGet } from "@/app/api/manage/[token]/calendar/route";
import { POST as cancelPost } from "@/app/api/manage/[token]/cancel/route";
import { GET as manageGet } from "@/app/api/manage/[token]/route";
import { db } from "@/db/client";
import { auditLog, reservation } from "@/db/schema";
import type { ManageResponse } from "@/lib/api/contracts";
import { signToken } from "@/lib/security/tokens";
import { book, call, emailsFor, nextWeekday, refundedAtProvider, resetBookingData, row } from "./helpers";

beforeAll(async () => {
  process.env.SIM_WEBHOOK_DELIVERY = "inline";
  await resetBookingData();
});

function view(token: string, query = "") {
  return call<ManageResponse & { error?: { code: string; message: string } }>(manageGet, `/api/manage/${token}${query}`, {
    token,
  });
}

function cancel(token: string) {
  return call<{ status: string; refundCents: number; error?: { code: string; message: string } }>(
    cancelPost,
    `/api/manage/${token}/cancel`,
    { token },
    { method: "POST" },
  );
}

/** Moves a booking so it starts `hours` from now (keeping its turn time). */
async function startIn(id: string, hours: number) {
  await db().execute(sql`
    UPDATE reservation SET starts_at = now() + make_interval(secs => ${hours * 3600}::double precision),
                           ends_at = now() + make_interval(secs => ${hours * 3600}::double precision) + (ends_at - starts_at)
     WHERE id = ${id}
  `);
}

describe("manage link (G-9)", () => {
  it("shows the booking and the refund the policy gives right now", async () => {
    const b = await book({ table: "W1", date: nextWeekday(5, 4), time: "20:00", email: "manage.a@example.com" });
    const res = await view(b.manageToken);
    expect(res.status).toBe(200);
    expect(res.body.booking).toMatchObject({
      id: b.holdId,
      venueId: "halcyon",
      venueName: "Halcyon",
      table: "W1",
      tableLabel: "Window 1",
      tierName: "Window",
      priceCents: 4000,
      status: "confirmed",
      guestEmail: "manage.a@example.com",
      cardBrand: "visa",
      cardLast4: "4242",
      refundCents: 0,
    });
    expect(res.body.canCancel).toBe(true);
    expect(res.body.refund.policy).toBe("full");
    expect(res.body.refund.amountCents).toBe(4000);
    expect(res.body.refund.explanation).toMatch(
      /^Cancelling now refunds the full \$40\. Full refunds are available until 8:00 pm on /,
    );
    expect(res.body.calendarUrl).toBe(`/api/manage/${b.manageToken}/calendar`);
  });

  it("serves the calendar file", async () => {
    const b = await book({ table: "W2", date: nextWeekday(3, 4), time: "19:30" });
    const res = await call<string>(calendarGet, `/api/manage/${b.manageToken}/calendar`, { token: b.manageToken });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/calendar; charset=utf-8");
    expect(res.headers.get("content-disposition")).toMatch(/^attachment; filename="halcyon-\d{4}-\d{2}-\d{2}\.ics"$/);
    expect(res.body).toContain("SUMMARY:Dinner at Halcyon\\, Window 2\r\n");
    expect(res.body).toContain(`UID:${b.holdId}@localhost`);
  });

  it("refund preview and actual refund agree: full at 24 hours or more", async () => {
    const b = await book({ table: "W3", date: nextWeekday(3, 4), time: "19:00" });
    await startIn(b.holdId, 24 + 1 / 6);
    const preview = await view(b.manageToken);
    expect(preview.body.refund).toMatchObject({ policy: "full", amountCents: b.priceCents });
    const res = await cancel(b.manageToken);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "cancelled", refundCents: preview.body.refund.amountCents });
    expect(await refundedAtProvider(b.paymentIntentId)).toBe(b.priceCents);
    const r = await row(b.holdId);
    expect(r).toMatchObject({
      status: "cancelled",
      cancelReason: "guest",
      refundCents: b.priceCents,
      refundDueCents: b.priceCents,
    });
    expect(await emailsFor(b.holdId, "booking-cancelled")).toHaveLength(1);
    expect(await emailsFor(b.holdId, "venue-booking-cancelled")).toHaveLength(1);
    const audits = await db().select().from(auditLog).where(eq(auditLog.reservationId, b.holdId));
    expect(audits.find((a) => a.action === "booking.cancelled")).toMatchObject({ actorType: "guest", amountCents: b.priceCents });
    // Cancelled now; the view says so and a second cancel is refused.
    const after = await view(b.manageToken);
    expect(after.body.canCancel).toBe(false);
    expect(after.body.refund.explanation).toBe(`This booking is cancelled. $25 was refunded.`);
    expect((await cancel(b.manageToken)).status).toBe(409);
    expect(await refundedAtProvider(b.paymentIntentId)).toBe(b.priceCents);
  });

  it("refund preview and actual refund agree: none under 24 hours", async () => {
    const b = await book({ table: "W4", date: nextWeekday(3, 4), time: "19:00" });
    await startIn(b.holdId, 23.5);
    const preview = await view(b.manageToken);
    expect(preview.body.refund).toEqual({
      policy: "none",
      amountCents: 0,
      explanation: "Your booking is less than 24 hours away, so cancelling now does not refund the $25 table fee.",
    });
    const res = await cancel(b.manageToken);
    expect(res.body).toEqual({ status: "cancelled", refundCents: 0 });
    expect(await refundedAtProvider(b.paymentIntentId)).toBe(0);
    expect((await row(b.holdId)).refundDueCents).toBe(0);
    const mail = await emailsFor(b.holdId, "booking-cancelled");
    expect(mail[0]!.text).toContain("is not refunded");
  });

  it("booking A's link can never read or cancel booking B (red team)", async () => {
    const a = await book({ table: "W5", date: nextWeekday(4, 4), time: "19:00" });
    const b = await book({ table: "W6", date: nextWeekday(4, 4), time: "19:00" });
    // Anything else in the request is ignored: the token alone picks the booking.
    const res = await view(a.manageToken, `?id=${b.holdId}&reservationId=${b.holdId}`);
    expect(res.body.booking.id).toBe(a.holdId);
    const cancelled = await call(
      cancelPost,
      `/api/manage/${a.manageToken}/cancel?id=${b.holdId}`,
      { token: a.manageToken },
      {
        body: { id: b.holdId, reservationId: b.holdId },
      },
    );
    expect(cancelled.status).toBe(200);
    expect((await row(a.holdId)).status).toBe("cancelled");
    expect((await row(b.holdId)).status).toBe("confirmed");
  });

  it("refuses tampered, foreign, expired and revoked tokens", async () => {
    const b = await book({ table: "C1", date: nextWeekday(4, 4), time: "19:00" });
    const r = await row(b.holdId);
    const [head, payload, sig] = b.manageToken.split(".") as [string, string, string];
    const flipped = `${head}.${payload}.${sig.slice(0, -2)}${sig.at(-2) === "A" ? "B" : "A"}${sig.at(-1)}`;
    expect((await view(flipped)).status).toBe(401);
    // A payload swapped for another booking's id fails the signature.
    const other = Buffer.from(
      JSON.stringify({ sub: "00000000-0000-7000-8000-000000000000", nonce: r.manageNonce, aud: "manage" }),
    ).toString("base64url");
    expect((await view(`${head}.${other}.${sig}`)).status).toBe(401);
    // A hold token is not a manage token.
    const holdToken = await signToken("hold", { sub: b.holdId, expiresAt: new Date(Date.now() + 60_000) });
    expect((await view(holdToken)).status).toBe(401);
    const expired = await signToken("manage", { sub: b.holdId, nonce: r.manageNonce, expiresAt: new Date(Date.now() - 1000) });
    const res = await view(expired);
    expect(res.status).toBe(410);
    expect(res.body.error?.code).toBe("link_expired");
    expect((await cancel(expired)).status).toBe(410);
    // Rotating the nonce revokes every earlier link.
    await db().update(reservation).set({ manageNonce: "rotated-nonce-value" }).where(eq(reservation.id, b.holdId));
    expect((await view(b.manageToken)).status).toBe(401);
    expect((await cancel(b.manageToken)).status).toBe(401);
    expect((await row(b.holdId)).status).toBe("confirmed");
  });

  it("a held reservation that was never paid has no manage page", async () => {
    const { heldOk } = await import("./helpers");
    const h = await heldOk({ table: "C2", date: nextWeekday(4, 4), time: "19:00" });
    const r = await row(h.hold.id);
    const token = await signToken("manage", { sub: r.id, nonce: r.manageNonce, expiresAt: new Date(Date.now() + 86_400_000) });
    expect((await view(token)).status).toBe(404);
  });
});
