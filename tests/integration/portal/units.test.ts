import { describe, expect, it } from "vitest";
import { signInEmail } from "@/lib/portal/emails";
import { historyLabel } from "@/lib/portal/history";
import { centsToInput, parseDollars } from "@/lib/portal/money";
import { daysFor, describeDays, turnTimeProblem } from "@/lib/portal/rules";
import { localDayRange, localToUtc, utcToLocal, zoneAbbreviation } from "@/lib/portal/time";

describe("money inputs", () => {
  it("parses dollars into exact cents", () => {
    expect(parseDollars("25")).toBe(2500);
    expect(parseDollars("$40")).toBe(4000);
    expect(parseDollars(" 19.99 ")).toBe(1999);
    expect(parseDollars("0.29")).toBe(29);
    expect(parseDollars("25.5")).toBe(2550);
    expect(parseDollars(".5")).toBe(50);
    expect(parseDollars("1,000")).toBe(100_000);
    expect(parseDollars("0")).toBe(0);
  });

  it("rejects anything that is not a fee", () => {
    for (const bad of ["", "abc", "-5", "25.999", "1e3", "1000.01", "12.3.4", "$"]) expect(parseDollars(bad)).toBeNull();
  });

  it("shows stored cents as dollars", () => {
    expect(centsToInput(2500)).toBe("25");
    expect(centsToInput(2550)).toBe("25.50");
    expect(centsToInput(1999)).toBe("19.99");
    expect(centsToInput(5)).toBe("0.05");
    for (const c of [0, 1, 99, 100, 1999, 4210, 100_000]) expect(parseDollars(centsToInput(c))).toBe(c);
  });
});

describe("venue time zones", () => {
  it("converts local wall-clock times across the November clock change", () => {
    const la = "America/Los_Angeles";
    expect(localToUtc("2026-10-31", "17:00", la).toISOString()).toBe("2026-11-01T00:00:00.000Z");
    expect(localToUtc("2026-11-02", "17:00", la).toISOString()).toBe("2026-11-03T01:00:00.000Z");
    expect(localToUtc("2026-11-01", "00:00", la).toISOString()).toBe("2026-11-01T07:00:00.000Z");
    expect(localToUtc("2026-11-01", "03:00", la).toISOString()).toBe("2026-11-01T11:00:00.000Z");
    const day = localDayRange("2026-11-01", la);
    expect((day.end.getTime() - day.start.getTime()) / 3_600_000).toBe(25);
    expect(utcToLocal("2026-11-03T01:00:00.000Z", la)).toEqual({ date: "2026-11-02", time: "17:00" });
    expect(zoneAbbreviation("2026-10-31", la)).toBe("PDT");
    expect(zoneAbbreviation("2026-11-02", la)).toBe("PST");
  });

  it("converts across the March clock change and in other zones", () => {
    const la = "America/Los_Angeles";
    const day = localDayRange("2027-03-14", la);
    expect((day.end.getTime() - day.start.getTime()) / 3_600_000).toBe(23);
    expect(localToUtc("2027-03-14", "17:00", la).toISOString()).toBe("2027-03-15T00:00:00.000Z");
    expect(localToUtc("2026-11-02", "17:30", "America/New_York").toISOString()).toBe("2026-11-02T22:30:00.000Z");
    expect(utcToLocal("2026-11-02T22:30:00.000Z", "America/New_York")).toEqual({ date: "2026-11-02", time: "17:30" });
  });
});

const t = (minParty: number, maxParty: number) => ({ minParty, maxParty, minutes: 90 });

describe("turn-time coverage", () => {
  it("accepts full coverage in any order", () => {
    expect(turnTimeProblem([t(3, 4), t(1, 2), t(5, 6)], 6)).toBeNull();
    expect(turnTimeProblem([t(1, 20)], 6)).toBeNull();
  });
  it("names the gap or overlap in plain words", () => {
    expect(turnTimeProblem([], 6)).toBe("Add a turn time for every party size.");
    expect(turnTimeProblem([t(1, 2), t(4, 6)], 6)).toBe("Parties of 3 have no turn time.");
    expect(turnTimeProblem([t(1, 2)], 6)).toBe("Parties of 3 to 6 have no turn time.");
    expect(turnTimeProblem([t(1, 3), t(2, 6)], 6)).toBe("Party size 2 is covered twice.");
    expect(turnTimeProblem([t(1, 2), t(4, 3)], 6)).toBe("The range 4 to 3 runs backwards.");
  });
});

describe("day labels", () => {
  it("describes weekday sets the way a host reads them", () => {
    expect(describeDays([1, 2, 3, 4, 7])).toBe("Sun to Thu");
    expect(describeDays([5, 6])).toBe("Fri, Sat");
    expect(describeDays([7])).toBe("Sun");
    expect(describeDays([1, 2, 3, 4, 5, 6, 7])).toBe("Every day");
    expect(describeDays([1, 3, 5])).toBe("Mon, Wed, Fri");
    expect(daysFor([5, 6, 7], [5, 6], "weeknight")).toEqual([7]);
    expect(daysFor([1, 2, 3, 4, 5, 6, 7], [5, 6], "weekend")).toEqual([5, 6]);
  });
});

describe("sign-in email", () => {
  it("escapes every value and has a plain-text part", () => {
    const mail = signInEmail({
      venueName: "Bar <b>&</b>",
      operatorName: 'Sam "O\'Neil"',
      url: "https://x.example/portal/auth?token=a&b=<c>",
    });
    expect(mail.subject).toBe("Sign in to Bar <b>&</b>");
    expect(mail.html).toContain("Sign in to Bar &lt;b&gt;&amp;&lt;/b&gt;");
    expect(mail.html).not.toContain("<b>&</b>");
    expect(mail.html).toContain("token=a&amp;b=&lt;c&gt;");
    expect(mail.html).toContain("Hi Sam,");
    expect(mail.text).toContain("https://x.example/portal/auth?token=a&b=<c>");
    expect(mail.text).toContain("valid for 15 minutes");
  });
});

describe("history labels", () => {
  it("reads booking-service audit actions in plain words", () => {
    expect(historyLabel("reservation.refunded")).toBe("Refund");
    expect(historyLabel("reservation.cancelled_by_venue")).toBe("Cancelled");
    expect(historyLabel("reservation.seated")).toBe("Seated");
    expect(historyLabel("reservation.no_show")).toBe("Marked no-show");
    expect(historyLabel("reservation.confirmation_resent")).toBe("Confirmation resent");
    expect(historyLabel("hold.expired")).toBe("Hold expired");
    expect(historyLabel("payment.succeeded")).toBe("Booked and paid");
    expect(historyLabel("venue.custom_note")).toBe("Venue custom note");
  });
});
