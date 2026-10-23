import { describe, expect, it } from "vitest";
import {
  bookableSlots,
  daySlots,
  dayTypeFor,
  findSlot,
  lastBookableDate,
  type SlotConfig,
  slotEnd,
  slotProblem,
  turnMinutes,
} from "@/lib/booking/slots";
import { localDateTime, startOfLocalDay, zonedInstant } from "@/lib/booking/time";
import { loadVenue } from "@/lib/venue/load";
import type { Venue } from "@/lib/venue/schema";

function config(v: Venue): SlotConfig {
  return {
    timezone: v.timezone,
    slotMinutes: v.booking.slotMinutes,
    minLeadMinutes: v.booking.minLeadMinutes,
    bookingWindowDays: v.booking.bookingWindowDays,
    weekendDays: v.booking.weekendDays,
    dayparts: v.booking.dayparts,
  };
}

const halcyon = config(await loadVenue("halcyon"));
const orchard = config(await loadVenue("orchard-room"));
const turns = (await loadVenue("halcyon")).booking.turnTimes;
const iso = (d: Date) => d.toISOString();
const at = (cfg: SlotConfig, date: string, time: string) => findSlot(cfg, date, time)!.startsAt;

describe("slot grid", () => {
  it("starts every 15 minutes inside each daypart, half-open", () => {
    const wed = daySlots(halcyon, "2026-11-04");
    expect(wed.map((s) => s.time)).toEqual([
      "17:00",
      "17:15",
      "17:30",
      "17:45",
      "18:00",
      "18:15",
      "18:30",
      "18:45",
      "19:00",
      "19:15",
      "19:30",
      "19:45",
      "20:00",
      "20:15",
      "20:30",
      "20:45",
      "21:00",
      "21:15",
      "21:30",
      "21:45",
    ]);
    expect(wed.every((s) => s.daypart === "dinner" && s.daypartName === "Dinner")).toBe(true);
    // Lunch runs Friday to Sunday: 11:30 to 14:15.
    const fri = daySlots(halcyon, "2026-11-06");
    expect(fri.filter((s) => s.daypart === "lunch").map((s) => s.time)).toEqual([
      "11:30",
      "11:45",
      "12:00",
      "12:15",
      "12:30",
      "12:45",
      "13:00",
      "13:15",
      "13:30",
      "13:45",
      "14:00",
      "14:15",
    ]);
    expect(fri).toHaveLength(32);
    expect(findSlot(halcyon, "2026-11-04", "22:00")).toBeNull();
    expect(findSlot(halcyon, "2026-11-04", "19:10")).toBeNull();
    expect(findSlot(halcyon, "2026-11-04", "12:00")).toBeNull();
  });

  it("turn time follows the party size", () => {
    expect([1, 2, 3, 4, 5, 6].map((p) => turnMinutes(turns, p))).toEqual([90, 90, 120, 120, 150, 150]);
    expect(turnMinutes(turns, 7)).toBeNull();
  });
});

describe("daylight saving time, America/Los_Angeles", () => {
  it("fall back, 2026-11-01: slot and turn-time end instants on both sides", () => {
    // Saturday Oct 31 is PDT (UTC-7); Sunday Nov 1 is PST (UTC-8).
    expect(iso(at(halcyon, "2026-10-31", "17:00"))).toBe("2026-11-01T00:00:00.000Z");
    expect(iso(at(halcyon, "2026-10-31", "21:45"))).toBe("2026-11-01T04:45:00.000Z");
    expect(iso(at(halcyon, "2026-11-01", "17:00"))).toBe("2026-11-02T01:00:00.000Z");
    expect(iso(at(halcyon, "2026-11-01", "11:30"))).toBe("2026-11-01T19:30:00.000Z");
    expect(iso(slotEnd(at(halcyon, "2026-10-31", "21:45"), 150))).toBe("2026-11-01T07:15:00.000Z");
    expect(iso(slotEnd(at(halcyon, "2026-11-01", "20:00"), 90))).toBe("2026-11-02T05:30:00.000Z");
    // Every slot of the day is exactly 15 real minutes after the one before it.
    for (const date of ["2026-10-31", "2026-11-01", "2026-11-02"]) {
      const dinner = daySlots(halcyon, date).filter((s) => s.daypart === "dinner");
      for (let i = 1; i < dinner.length; i++) {
        expect(dinner[i]!.startsAt.getTime() - dinner[i - 1]!.startsAt.getTime()).toBe(15 * 60_000);
      }
    }
  });

  it("spring forward, 2026-03-08 and 2027-03-14", () => {
    expect(iso(at(halcyon, "2026-03-07", "17:00"))).toBe("2026-03-08T01:00:00.000Z");
    expect(iso(at(halcyon, "2026-03-08", "17:00"))).toBe("2026-03-09T00:00:00.000Z");
    expect(iso(at(halcyon, "2027-03-13", "19:00"))).toBe("2027-03-14T03:00:00.000Z");
    expect(iso(at(halcyon, "2027-03-14", "19:00"))).toBe("2027-03-15T02:00:00.000Z");
    expect(iso(at(halcyon, "2027-03-14", "11:30"))).toBe("2027-03-14T18:30:00.000Z");
    expect(iso(slotEnd(at(halcyon, "2027-03-13", "21:45"), 120))).toBe("2027-03-14T07:45:00.000Z");
    expect(iso(slotEnd(at(halcyon, "2027-03-14", "21:45"), 120))).toBe("2027-03-15T06:45:00.000Z");
  });

  it("a daypart across the clock change skips the missing hour and counts the repeated hour once", () => {
    const late: SlotConfig = {
      ...halcyon,
      dayparts: [{ id: "late", name: "Late", days: [1, 2, 3, 4, 5, 6, 7], start: "00:30", end: "04:00" }],
    };
    // Spring forward: 02:00 to 02:59 does not exist on 2027-03-14.
    const spring = daySlots(late, "2027-03-14");
    expect(spring.map((s) => s.time)).toEqual([
      "00:30",
      "00:45",
      "01:00",
      "01:15",
      "01:30",
      "01:45",
      "03:00",
      "03:15",
      "03:30",
      "03:45",
    ]);
    expect(iso(spring.find((s) => s.time === "01:45")!.startsAt)).toBe("2027-03-14T09:45:00.000Z");
    expect(iso(spring.find((s) => s.time === "03:00")!.startsAt)).toBe("2027-03-14T10:00:00.000Z");
    // A 90-minute booking at 01:45 PST ends at 04:15 PDT: 90 real minutes.
    const end = slotEnd(spring.find((s) => s.time === "01:45")!.startsAt, 90);
    expect(iso(end)).toBe("2027-03-14T11:15:00.000Z");
    expect(localDateTime(end, "America/Los_Angeles").time).toBe("04:15");

    // Fall back: 01:00 to 01:59 happens twice on 2026-11-01; each wall time is offered once.
    const fall = daySlots(late, "2026-11-01");
    expect(fall).toHaveLength(14);
    expect(iso(fall.find((s) => s.time === "01:00")!.startsAt)).toBe("2026-11-01T08:00:00.000Z");
    const end2 = slotEnd(fall.find((s) => s.time === "00:45")!.startsAt, 90);
    expect(iso(end2)).toBe("2026-11-01T09:15:00.000Z");
    expect(localDateTime(end2, "America/Los_Angeles").time).toBe("01:15");
  });
});

describe("daylight saving time, America/New_York", () => {
  it("fall back 2026-11-01 and spring forward 2027-03-14", () => {
    expect(iso(at(orchard, "2026-10-31", "17:30"))).toBe("2026-10-31T21:30:00.000Z");
    expect(iso(at(orchard, "2026-11-01", "17:30"))).toBe("2026-11-01T22:30:00.000Z");
    expect(iso(at(orchard, "2026-11-01", "10:30"))).toBe("2026-11-01T15:30:00.000Z");
    expect(iso(at(orchard, "2027-03-13", "10:30"))).toBe("2027-03-13T15:30:00.000Z");
    expect(iso(at(orchard, "2027-03-14", "10:30"))).toBe("2027-03-14T14:30:00.000Z");
    expect(iso(slotEnd(at(orchard, "2026-10-31", "22:15"), 135))).toBe("2026-11-01T04:30:00.000Z");
    expect(iso(slotEnd(at(orchard, "2026-11-01", "22:15"), 135))).toBe("2026-11-02T05:30:00.000Z");
    expect(
      daySlots(orchard, "2026-11-04")
        .map((s) => s.time)
        .at(-1),
    ).toBe("22:15");
  });

  it("local day boundaries follow the zone", () => {
    expect(iso(startOfLocalDay("2026-11-01", "America/New_York"))).toBe("2026-11-01T04:00:00.000Z");
    expect(iso(startOfLocalDay("2026-11-02", "America/New_York"))).toBe("2026-11-02T05:00:00.000Z");
    expect(zonedInstant("2027-03-14", "02:30", "America/New_York")).toBeNull();
  });
});

describe("what guests can book", () => {
  const now = new Date("2026-11-04T23:30:00.000Z"); // 15:30 in Los Angeles

  it("honors the lead time", () => {
    const today = bookableSlots(halcyon, "2026-11-04", now).map((s) => s.time);
    expect(today[0]).toBe("17:00");
    const closer = new Date("2026-11-05T00:15:00.000Z"); // 16:15: 17:00 is 45 minutes away
    expect(bookableSlots(halcyon, "2026-11-04", closer)[0]!.time).toBe("17:15");
    expect(slotProblem(halcyon, findSlot(halcyon, "2026-11-04", "17:00")!, closer)).toBe("too_soon");
    const exact = new Date("2026-11-05T00:00:00.000Z"); // 16:00, exactly 60 minutes before 17:00
    expect(slotProblem(halcyon, findSlot(halcyon, "2026-11-04", "17:00")!, exact)).toBeNull();
  });

  it("honors the booking window in the venue's time zone", () => {
    expect(lastBookableDate(halcyon, now)).toBe("2027-01-03");
    expect(bookableSlots(halcyon, "2027-01-03", now)).toHaveLength(32); // a Sunday: lunch and dinner
    expect(bookableSlots(halcyon, "2027-01-04", now)).toHaveLength(0);
    expect(slotProblem(halcyon, findSlot(halcyon, "2027-01-04", "19:00")!, now)).toBe("too_far");
    // The Orchard Room books 45 days ahead, counted from its own date.
    expect(lastBookableDate(orchard, now)).toBe("2026-12-19");
  });

  it("day types: special date, then weekend days, else weeknight", () => {
    const special = new Set(["2026-12-31"]);
    expect(dayTypeFor("2026-11-06", [5, 6], special)).toBe("weekend"); // Friday
    expect(dayTypeFor("2026-11-07", [5, 6], special)).toBe("weekend"); // Saturday
    expect(dayTypeFor("2026-11-08", [5, 6], special)).toBe("weeknight"); // Sunday
    expect(dayTypeFor("2026-11-04", [5, 6], special)).toBe("weeknight");
    expect(dayTypeFor("2026-12-31", [5, 6], special)).toBe("special");
  });
});
