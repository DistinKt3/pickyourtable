import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/db/client";
import { auditLog } from "@/db/schema";
import {
  cancelByVenue,
  listBookings,
  listTonight,
  markNoShow,
  OperationError,
  resendConfirmation,
  seatReservation,
  undoArrival,
} from "@/lib/booking/operations";
import { book, emailsFor, heldOk, nextWeekday, refundedAtProvider, resetBookingData, row } from "./helpers";

const host = { type: "operator" as const, id: "00000000-0000-7000-8000-00000000a001" };
const owner = { type: "operator" as const, id: "00000000-0000-7000-8000-00000000a002" };

beforeAll(async () => {
  process.env.SIM_WEBHOOK_DELIVERY = "inline";
  await resetBookingData();
});

async function rejects(p: Promise<unknown>, status: number, code?: string) {
  const e = await p.then(
    () => null,
    (err: unknown) => err,
  );
  expect(e).toBeInstanceOf(OperationError);
  const err = e as OperationError;
  expect({ status: err.status, code: code ? err.code : undefined }).toEqual({ status, code });
  return err;
}

async function audits(reservationId: string) {
  return db().select().from(auditLog).where(eq(auditLog.reservationId, reservationId));
}

describe("operator operations (O-1, O-2)", () => {
  it("seating at a different table refunds the full fee automatically and emails the guest", async () => {
    const b = await book({ table: "W1", date: nextWeekday(3, 5), time: "19:00", email: "seated@example.com" });
    const res = await seatReservation({ venueId: "halcyon", reservationId: b.holdId, tableCode: "S2", actor: host });
    expect(res.refundCents).toBe(b.priceCents);
    expect(res.reservation).toMatchObject({
      status: "seated",
      table: "W1",
      seatedTable: "S2",
      refundCents: b.priceCents,
      paid: false,
    });
    expect(await refundedAtProvider(b.paymentIntentId)).toBe(b.priceCents);
    const r = await row(b.holdId);
    expect(r).toMatchObject({ status: "seated", refundCents: b.priceCents, refundDueCents: b.priceCents });
    const mail = await emailsFor(b.holdId, "seated-elsewhere-refund");
    expect(mail).toHaveLength(1);
    expect(mail[0]!.text).toContain("You were seated at Table 12 instead of Window 1");
    expect((await audits(b.holdId)).find((a) => a.action === "booking.seated_elsewhere")).toMatchObject({
      actorType: "operator",
      actorId: host.id,
      amountCents: b.priceCents,
    });
    // Undo is refused once money went back.
    await rejects(undoArrival({ venueId: "halcyon", reservationId: b.holdId, actor: host }), 409, "refund_issued");
  });

  it("seating at the paid table refunds nothing, and can be undone", async () => {
    const b = await book({ table: "W2", date: nextWeekday(3, 5), time: "19:00" });
    const res = await seatReservation({ venueId: "halcyon", reservationId: b.holdId, actor: host });
    expect(res).toMatchObject({ refundCents: 0, reservation: { status: "seated", seatedTable: null, paid: true } });
    expect(await refundedAtProvider(b.paymentIntentId)).toBe(0);
    await rejects(seatReservation({ venueId: "halcyon", reservationId: b.holdId, actor: host }), 409, "invalid_state");
    const undone = await undoArrival({ venueId: "halcyon", reservationId: b.holdId, actor: host });
    expect(undone.reservation.status).toBe("confirmed");
  });

  it("a no-show refunds nothing", async () => {
    const b = await book({ table: "W3", date: nextWeekday(3, 5), time: "19:00" });
    const res = await markNoShow({ venueId: "halcyon", reservationId: b.holdId, actor: host });
    expect(res).toMatchObject({ refundCents: 0, reservation: { status: "no_show", paid: true } });
    expect(await refundedAtProvider(b.paymentIntentId)).toBe(0);
    expect((await audits(b.holdId)).find((a) => a.action === "booking.no_show")).toBeTruthy();
    const undone = await undoArrival({ venueId: "halcyon", reservationId: b.holdId, actor: host });
    expect(undone.reservation.status).toBe("confirmed");
  });

  it("a venue cancellation refunds in full and emails the guest and the venue", async () => {
    const b = await book({ table: "W4", date: nextWeekday(5, 5), time: "20:00", email: "cancelled.by.venue@example.com" });
    const res = await cancelByVenue({
      venueId: "halcyon",
      reservationId: b.holdId,
      reason: "Kitchen closed for repairs",
      actor: owner,
    });
    expect(res.refundCents).toBe(4000);
    expect(res.reservation).toMatchObject({ status: "cancelled", refundCents: 4000, paid: false });
    expect(await refundedAtProvider(b.paymentIntentId)).toBe(4000);
    const guestMail = await emailsFor(b.holdId, "booking-cancelled");
    expect(guestMail).toHaveLength(1);
    expect(guestMail[0]!.text).toContain("Halcyon has cancelled your booking");
    expect(guestMail[0]!.text).toContain("We have refunded $40");
    // The operator's reason is for the audit log, not the guest.
    expect(guestMail[0]!.html).not.toContain("Kitchen closed");
    expect(await emailsFor(b.holdId, "venue-booking-cancelled")).toHaveLength(1);
    expect((await audits(b.holdId)).find((a) => a.action === "booking.cancelled")).toMatchObject({
      actorId: owner.id,
      amountCents: 4000,
      details: { by: "venue", reason: "Kitchen closed for repairs" },
    });
    await rejects(cancelByVenue({ venueId: "halcyon", reservationId: b.holdId, reason: "Again", actor: owner }), 409);
    await rejects(markNoShow({ venueId: "halcyon", reservationId: b.holdId, actor: host }), 409);
  });

  it("refuses another venue's booking, unknown ids and unpaid holds", async () => {
    const b = await book({ table: "W5", date: nextWeekday(3, 5), time: "19:00" });
    await rejects(seatReservation({ venueId: "orchard-room", reservationId: b.holdId, actor: host }), 404, "not_found");
    await rejects(cancelByVenue({ venueId: "orchard-room", reservationId: b.holdId, reason: "Nope", actor: owner }), 404);
    await rejects(resendConfirmation({ venueId: "orchard-room", reservationId: b.holdId, actor: host }), 404);
    await rejects(markNoShow({ venueId: "halcyon", reservationId: "00000000-0000-7000-8000-000000000000", actor: host }), 404);
    await rejects(markNoShow({ venueId: "halcyon", reservationId: "not-a-uuid", actor: host }), 404);
    const h = await heldOk({ table: "W6", date: nextWeekday(3, 5), time: "19:00" });
    await rejects(seatReservation({ venueId: "halcyon", reservationId: h.hold.id, actor: host }), 404);
    expect((await row(b.holdId)).status).toBe("confirmed");
    const other = await listBookings({ venueId: "orchard-room", status: "all" });
    expect(other.bookings.some((x) => x.id === b.holdId)).toBe(false);
  });

  it("resends the confirmation", async () => {
    const b = await book({ table: "C1", date: nextWeekday(3, 5), time: "19:00" });
    await resendConfirmation({ venueId: "halcyon", reservationId: b.holdId, actor: host });
    expect(await emailsFor(b.holdId, "booking-confirmed")).toHaveLength(2);
  });
});

describe("Tonight and Bookings", () => {
  it("Tonight lists every paid booking for the date and the state of each table", async () => {
    const date = nextWeekday(2, 6);
    const paid = await book({ table: "B1", date, time: "17:00", party: 4 });
    const other = await book({ table: "B2", date, time: "20:00", party: 3 });
    await heldOk({ table: "B3", date, time: "17:00", party: 2 });
    const tonight = await listTonight({ venueId: "halcyon", date });
    expect(tonight.date).toBe(date);
    expect(tonight.reservations.map((r) => r.id)).toEqual([paid.holdId, other.holdId]);
    expect(tonight.reservations[0]).toMatchObject({
      table: "B1",
      partySize: 4,
      paid: true,
      guestName: "Robin Example",
      occasion: "anniversary",
    });
    // Table states at the first service of that date (17:00).
    const state = new Map(tonight.tables.map((t) => [t.code, t.state]));
    expect(state.get("B1")).toBe("paid");
    expect(state.get("B2")).toBe("free");
    expect(state.get("B3")).toBe("held");
    expect(state.get("S1")).toBe("free");
    await seatReservation({ venueId: "halcyon", reservationId: paid.holdId, actor: host });
    const after = await listTonight({ venueId: "halcyon", date });
    expect(after.tables.find((t) => t.code === "B1")?.state).toBe("seated");
    expect(after.reservations[0]!.status).toBe("seated");
  });

  it("Bookings searches by guest name, email and table, with status filters", async () => {
    const b = await book({ table: "T4", date: nextWeekday(4, 7), time: "19:00", email: "findme.quickly@example.com" });
    const byEmail = await listBookings({ venueId: "halcyon", q: "findme.quickly", status: "upcoming" });
    expect(byEmail.bookings.map((x) => x.id)).toEqual([b.holdId]);
    const byTable = await listBookings({ venueId: "halcyon", q: "Terrace 4", status: "upcoming" });
    expect(byTable.bookings.map((x) => x.id)).toContain(b.holdId);
    const byName = await listBookings({ venueId: "halcyon", q: "robin", status: "upcoming" });
    expect(byName.bookings.length).toBeGreaterThan(1);
    const wildcard = await listBookings({ venueId: "halcyon", q: "%", status: "upcoming" });
    expect(wildcard.bookings).toHaveLength(0);
    const cancelled = await listBookings({ venueId: "halcyon", status: "cancelled" });
    expect(cancelled.bookings.every((x) => x.status === "cancelled")).toBe(true);
    expect(cancelled.bookings.length).toBeGreaterThanOrEqual(1);
    const upcoming = await listBookings({ venueId: "halcyon", status: "upcoming" });
    expect(upcoming.bookings.every((x) => x.status === "confirmed" || x.status === "seated")).toBe(true);
    const ranged = await listBookings({ venueId: "halcyon", status: "all", from: nextWeekday(4, 7), to: nextWeekday(4, 7) });
    expect(ranged.bookings.map((x) => x.id)).toEqual([b.holdId]);
  });
});
