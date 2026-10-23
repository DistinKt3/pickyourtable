import { describe, expect, it } from "vitest";
import { refundPolicy, refundPreviewFor } from "@/lib/booking/policy";

const startsAt = new Date("2026-11-07T04:00:00.000Z"); // Fri Nov 6, 8:00 pm in Los Angeles
const hours = (h: number) => new Date(startsAt.getTime() - h * 3_600_000);
const base = { startsAt, priceCents: 4000, refundedCents: 0, fullRefundHours: 24 };

describe("refund policy (PRD: full 24 h or more ahead, none under)", () => {
  it("exactly 24 hours ahead refunds in full", () => {
    expect(refundPolicy({ ...base, now: hours(24) })).toMatchObject({ policy: "full", amountCents: 4000 });
  });

  it("23 hours 59 minutes ahead refunds nothing", () => {
    expect(refundPolicy({ ...base, now: hours(23 + 59 / 60) })).toMatchObject({ policy: "none", amountCents: 0 });
    expect(refundPolicy({ ...base, now: new Date(hours(24).getTime() + 1) })).toMatchObject({ policy: "none", amountCents: 0 });
  });

  it("days ahead refunds what has not been refunded yet", () => {
    expect(refundPolicy({ ...base, now: hours(24 * 5) }).amountCents).toBe(4000);
    expect(refundPolicy({ ...base, now: hours(48), refundedCents: 500 }).amountCents).toBe(3500);
    expect(refundPolicy({ ...base, now: hours(48), refundedCents: 4000 }).amountCents).toBe(0);
  });

  it("explains the outcome in plain words, with the deadline in the venue's time zone", () => {
    expect(refundPreviewFor({ ...base, now: hours(30), timeZone: "America/Los_Angeles" })).toEqual({
      policy: "full",
      amountCents: 4000,
      explanation: "Cancelling now refunds the full $40. Full refunds are available until 8:00 pm on Thu, Nov 5.",
    });
    expect(refundPreviewFor({ ...base, now: hours(30), timeZone: "America/New_York" }).explanation).toContain(
      "11:00 pm on Thu, Nov 5",
    );
    expect(refundPreviewFor({ ...base, now: hours(2), timeZone: "America/Los_Angeles" })).toEqual({
      policy: "none",
      amountCents: 0,
      explanation: "Your booking is less than 24 hours away, so cancelling now does not refund the $40 table fee.",
    });
  });
});
