import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PortalReservation, TonightResponse } from "@/lib/api/contracts";

/**
 * Wiring between the portal routes and the booking service's reservation operations:
 * who may call each one, what reaches it (always the session's venue and actor, never
 * one from the request) and how its errors come back. The operations themselves are
 * the booking service's; here they are replaced with spies.
 */

type Operations = typeof import("@/lib/booking/operations");

const ops = vi.hoisted(() => ({
  listTonight: vi.fn<Operations["listTonight"]>(),
  listBookings: vi.fn<Operations["listBookings"]>(),
  seatReservation: vi.fn<Operations["seatReservation"]>(),
  markNoShow: vi.fn<Operations["markNoShow"]>(),
  undoArrival: vi.fn<Operations["undoArrival"]>(),
  cancelByVenue: vi.fn<Operations["cancelByVenue"]>(),
  resendConfirmation: vi.fn<Operations["resendConfirmation"]>(),
}));

vi.mock("@/lib/booking/operations", async (importOriginal) => {
  const actual = await importOriginal<Operations>();
  return { ...actual, ...ops };
});

const { OperationError } = await import("@/lib/booking/operations");
const { GET: tonightRoute } = await import("@/app/api/portal/tonight/route");
const { GET: bookingsRoute } = await import("@/app/api/portal/bookings/route");
const { POST: seatRoute } = await import("@/app/api/portal/reservations/[id]/seat/route");
const { POST: noShowRoute } = await import("@/app/api/portal/reservations/[id]/no-show/route");
const { POST: undoRoute } = await import("@/app/api/portal/reservations/[id]/undo/route");
const { POST: cancelRoute } = await import("@/app/api/portal/reservations/[id]/cancel/route");
const { POST: resendRoute } = await import("@/app/api/portal/reservations/[id]/resend/route");
const { call, errorCode, HALCYON_HOST, HALCYON_OWNER, ORCHARD_OWNER, request, signIn } = await import("./helpers");

const ID = "0190a0a0-0000-7000-8000-0000000000aa";

const reservation: PortalReservation = {
  id: ID,
  table: "W1",
  tableLabel: "Window 1",
  tier: "window",
  seatedTable: null,
  partySize: 2,
  slot: {
    date: "2026-10-30",
    time: "19:30",
    startsAt: "2026-10-31T02:30:00.000Z",
    endsAt: "2026-10-31T04:00:00.000Z",
    daypart: "dinner",
    daypartName: "Dinner",
    dayType: "weekend",
  },
  status: "seated",
  guestName: "Elena Marchetti",
  guestEmail: "elena@guest.example",
  guestMobile: "+1 415 555 0142",
  occasion: "anniversary",
  note: null,
  priceCents: 4000,
  refundCents: 0,
  paid: true,
  cardBrand: "visa",
  cardLast4: "4242",
  createdAt: "2026-10-20T18:00:00.000Z",
};

let host: string;
let owner: string;
let orchard: string;

beforeAll(async () => {
  [host, owner, orchard] = await Promise.all([signIn(HALCYON_HOST), signIn(HALCYON_OWNER), signIn(ORCHARD_OWNER)]);
});

beforeEach(() => {
  for (const fn of Object.values(ops)) fn.mockReset();
});

const post = (handler: typeof seatRoute, action: string, cookie: string, body?: unknown) =>
  call(handler, request("POST", `/api/portal/reservations/${ID}/${action}`, { cookie, body }), { id: ID });

describe("reservation operations from the portal", () => {
  it("a Host seats a guest: the session's venue and operator reach the operation", async () => {
    ops.seatReservation.mockResolvedValue({ reservation, refundCents: 0 });
    const r = await post(seatRoute, "seat", host, {});
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ reservation, refundCents: 0 });
    expect(ops.seatReservation).toHaveBeenCalledWith({
      venueId: "halcyon",
      reservationId: ID,
      tableCode: undefined,
      actor: { type: "operator", id: expect.any(String) },
    });
  });

  it("seating at a different table passes the table and returns the automatic refund", async () => {
    ops.seatReservation.mockResolvedValue({
      reservation: { ...reservation, seatedTable: "S2", refundCents: 4000 },
      refundCents: 4000,
    });
    const r = await post(seatRoute, "seat", host, { table: "S2" });
    expect(r.body).toMatchObject({ refundCents: 4000, reservation: { seatedTable: "S2" } });
    expect(ops.seatReservation).toHaveBeenCalledWith(expect.objectContaining({ tableCode: "S2" }));
  });

  it("a Host marks a no-show, undoes it and resends a confirmation", async () => {
    ops.markNoShow.mockResolvedValue({ reservation: { ...reservation, status: "no_show" }, refundCents: 0 });
    ops.undoArrival.mockResolvedValue({ reservation: { ...reservation, status: "confirmed" }, refundCents: 0 });
    ops.resendConfirmation.mockResolvedValue(undefined);
    expect((await post(noShowRoute, "no-show", host)).body).toMatchObject({ reservation: { status: "no_show" } });
    expect((await post(undoRoute, "undo", host)).body).toMatchObject({ reservation: { status: "confirmed" } });
    expect((await post(resendRoute, "resend", host)).body).toEqual({ ok: true });
    for (const fn of [ops.markNoShow, ops.undoArrival, ops.resendConfirmation]) {
      expect(fn).toHaveBeenCalledWith({
        venueId: "halcyon",
        reservationId: ID,
        actor: { type: "operator", id: expect.any(String) },
      });
    }
  });

  it("only an Owner cancels with a refund, and the reason reaches the operation", async () => {
    const denied = await post(cancelRoute, "cancel", host, { reason: "Kitchen fire" });
    expect(denied.status).toBe(403);
    expect(ops.cancelByVenue).not.toHaveBeenCalled();

    ops.cancelByVenue.mockResolvedValue({
      reservation: { ...reservation, status: "cancelled", refundCents: 4000 },
      refundCents: 4000,
    });
    const r = await post(cancelRoute, "cancel", owner, { reason: "  Kitchen fire  " });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ refundCents: 4000 });
    expect(ops.cancelByVenue).toHaveBeenCalledWith(
      expect.objectContaining({ venueId: "halcyon", reservationId: ID, reason: "Kitchen fire" }),
    );

    expect((await post(cancelRoute, "cancel", owner, { reason: "x" })).status).toBe(400);
  });

  it("another venue's Owner acts only on their own venue", async () => {
    ops.seatReservation.mockRejectedValue(new OperationError(404, "reservation_not_found", "That booking is not in this venue."));
    const r = await post(seatRoute, "seat", orchard, {});
    expect(r.status).toBe(404);
    expect(r.body).toEqual({ error: { code: "reservation_not_found", message: "That booking is not in this venue." } });
    expect(ops.seatReservation).toHaveBeenCalledWith(expect.objectContaining({ venueId: "orchard-room" }));
  });

  it("maps an OperationError to the same status, code and message", async () => {
    ops.undoArrival.mockRejectedValue(
      new OperationError(409, "refund_issued", "This guest was refunded, so it cannot be undone."),
    );
    const r = await post(undoRoute, "undo", host);
    expect(r.status).toBe(409);
    expect(r.body).toEqual({ error: { code: "refund_issued", message: "This guest was refunded, so it cannot be undone." } });
  });

  it("does not hide unexpected failures", async () => {
    ops.markNoShow.mockRejectedValue(new Error("database down"));
    const r = await post(noShowRoute, "no-show", host);
    expect(r.status).toBe(500);
    expect(errorCode(r)).toBe("server_error");
  });

  it("requires a session and a reservation id", async () => {
    expect((await post(seatRoute, "seat", "", {})).status).toBe(401);
    const bad = await call(seatRoute, request("POST", "/api/portal/reservations/nope/seat", { cookie: host, body: {} }), {
      id: "nope",
    });
    expect(bad.status).toBe(400);
  });

  it("Tonight and Bookings read the session's venue and pass the filters through", async () => {
    const tonight: TonightResponse = {
      venueId: "halcyon",
      date: "2026-10-30",
      generatedAt: "2026-10-31T02:45:00.000Z",
      reservations: [{ ...reservation, status: "confirmed" }],
      tables: [{ code: "W1", state: "paid" }],
    };
    ops.listTonight.mockResolvedValue(tonight);
    const t = await call(tonightRoute, request("GET", "/api/portal/tonight?date=2026-10-30", { cookie: host }));
    expect(t.status).toBe(200);
    expect(t.body).toEqual(tonight);
    expect(t.res.headers.get("cache-control")).toBe("no-store");
    expect(ops.listTonight).toHaveBeenCalledWith({ venueId: "halcyon", date: "2026-10-30" });

    ops.listBookings.mockResolvedValue({ bookings: [] });
    const b = await call(bookingsRoute, request("GET", "/api/portal/bookings?q=marchetti&status=past", { cookie: orchard }));
    expect(b.status).toBe(200);
    expect(ops.listBookings).toHaveBeenCalledWith({
      venueId: "orchard-room",
      q: "marchetti",
      status: "past",
      from: undefined,
      to: undefined,
    });

    expect((await call(tonightRoute, request("GET", "/api/portal/tonight?date=tomorrow", { cookie: host }))).status).toBe(400);
  });
});
