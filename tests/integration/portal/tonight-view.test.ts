import { describe, expect, it } from "vitest";
import type { PortalReservation, TonightResponse } from "@/lib/api/contracts";
import { arrival, arrivalText, canMarkNoShow, orderRows, planViews, summarize } from "@/lib/portal/tonight-view";
import type { RoomTable } from "@/lib/room/types";

const base: PortalReservation = {
  id: "0190a0a0-0000-7000-8000-0000000000b1",
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
  status: "confirmed",
  guestName: "Elena Marchetti",
  guestEmail: "elena@guest.example",
  guestMobile: "+1 415 555 0142",
  occasion: null,
  note: null,
  priceCents: 4000,
  refundCents: 0,
  paid: true,
  cardBrand: "visa",
  cardLast4: "4242",
  createdAt: "2026-10-20T18:00:00.000Z",
};

const at = (iso: string) => new Date(iso);

describe("Tonight read model", () => {
  it("reads arrival relative to the booking time", () => {
    expect(arrival(base, at("2026-10-31T01:30:00.000Z"))).toEqual({ kind: "upcoming", minutes: 60 });
    expect(arrival(base, at("2026-10-31T02:20:00.000Z"))).toEqual({ kind: "due", minutes: 10 });
    expect(arrival(base, at("2026-10-31T02:45:00.000Z"))).toEqual({ kind: "late", minutes: 15 });
    expect(arrival(base, at("2026-10-31T04:05:00.000Z"))).toEqual({ kind: "ended" });
    expect(arrival({ ...base, status: "seated" }, at("2026-10-31T02:45:00.000Z")).kind).toBe("seated");
    expect(arrivalText({ kind: "late", minutes: 75 })).toBe("1 h 15 min late");
    expect(arrivalText({ kind: "due", minutes: 0 })).toBe("Due now");
  });

  it("looks ahead without arrival actions, and offers No-show only once the guest is late", () => {
    expect(arrival(base, at("2026-10-30T07:00:00.000Z"), true)).toEqual({ kind: "ahead" });
    expect(arrivalText({ kind: "ahead" })).toBe("Booked");
    expect(arrival({ ...base, status: "cancelled" }, at("2026-10-30T07:00:00.000Z"), true).kind).toBe("cancelled");
    expect(canMarkNoShow(arrival(base, at("2026-10-31T02:20:00.000Z")))).toBe(false);
    expect(canMarkNoShow(arrival(base, at("2026-10-31T02:45:00.000Z")))).toBe(true);
    expect(canMarkNoShow(arrival(base, at("2026-10-31T04:05:00.000Z")))).toBe(true);
    expect(canMarkNoShow({ kind: "ahead" })).toBe(false);
  });

  it("counts tonight and keeps refunds out of the fees", () => {
    const s = summarize(
      [
        base,
        { ...base, id: "b", status: "seated", seatedTable: "S2", refundCents: 4000 },
        { ...base, id: "c", status: "no_show" },
        { ...base, id: "d", status: "cancelled", refundCents: 4000 },
      ],
      at("2026-10-31T02:45:00.000Z"),
    );
    expect(s).toEqual({ paid: 3, toArrive: 1, seated: 1, noShows: 1, late: 1, feesCents: 8000 });
  });

  it("pins paid, late, seated and blocked tables on the plan", () => {
    const tables = [
      { id: "W1", label: "Window 1", bookable: true },
      { id: "W2", label: "Window 2", bookable: true },
      { id: "S2", label: "Table 12", bookable: false },
      { id: "T4", label: "Terrace 4", bookable: true },
      { id: "W3", label: "Window 3", bookable: true },
    ] as RoomTable[];
    const data: TonightResponse = {
      venueId: "halcyon",
      date: "2026-10-30",
      generatedAt: "2026-10-31T02:45:00.000Z",
      reservations: [
        base,
        {
          ...base,
          id: "w2",
          table: "W2",
          tableLabel: "Window 2",
          guestName: "Maya Abernathy",
          slot: { ...base.slot, time: "20:00", startsAt: "2026-10-31T03:00:00.000Z" },
        },
        { ...base, id: "s", table: "W3", seatedTable: "S2", status: "seated", guestName: "Ana Ferreira" },
      ],
      tables: [{ code: "T4", state: "blocked" }],
    };
    const views = planViews(tables, data, at("2026-10-31T02:45:00.000Z"));
    expect(views.W1).toMatchObject({ ring: "bold", badge: "7:30", badgeTone: "warning", detail: "Marchetti", priority: 5 });
    expect(views.W2).toMatchObject({ ring: "bold", badge: "8:00", badgeTone: "accent", detail: "Abernathy", priority: 4 });
    expect(views.S2).toMatchObject({ short: "12", badge: "Seated", badgeTone: "success", detail: "Ferreira" });
    expect(views.T4).toMatchObject({ ring: "hatched", detail: "Blocked" });
    expect(views.W3).toMatchObject({ ring: "none", muted: true });
    expect(views.W3?.badge).toBeUndefined();
    expect(views.W1?.ariaLabel).toBe("Window 1, paid, Elena Marchetti at 7:30 pm, party of 2, late");
  });

  it("orders rows by time with cancellations last and holds left out", () => {
    const rows = orderRows([
      { ...base, id: "later", slot: { ...base.slot, startsAt: "2026-10-31T04:00:00.000Z" } },
      { ...base, id: "gone", status: "cancelled", slot: { ...base.slot, startsAt: "2026-10-31T00:00:00.000Z" } },
      { ...base, id: "first", slot: { ...base.slot, startsAt: "2026-10-31T01:00:00.000Z" } },
      { ...base, id: "held", status: "held" },
    ]);
    expect(rows.map((r) => r.id)).toEqual(["first", "later", "gone"]);
  });
});
