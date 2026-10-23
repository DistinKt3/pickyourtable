import { describe, expect, it } from "vitest";
import { buildIcs, icsDate, icsEscape, icsFold } from "@/lib/booking/ics";

const event = {
  uid: "01a16711-5e10-7c8f-9883-a8e204205f3e@pyt.example",
  start: new Date("2026-11-07T04:00:00.000Z"),
  end: new Date("2026-11-07T05:30:00.000Z"),
  stamp: new Date("2026-10-23T12:00:00.000Z"),
  summary: "Dinner at Halcyon, Window 1",
  location: "Halcyon, 1 Harbor Walk, Demo Bay, CA",
  description:
    "Window 1 for 2 guests. View or cancel your booking: https://pyt.example/v/halcyon/manage/eyJhbGciOiJIUzI1NiJ9.payload.signature",
  url: "https://pyt.example/v/halcyon/manage/eyJhbGciOiJIUzI1NiJ9.payload.signature",
  organizerName: "Halcyon",
  status: "CONFIRMED" as const,
};

function unfold(ics: string): string[] {
  return ics.replace(/\r\n /g, "").split("\r\n");
}

describe("calendar file (RFC 5545)", () => {
  it("uses CRLF line endings and folds every line to 75 octets", () => {
    const ics = buildIcs(event);
    expect(ics.endsWith("\r\n")).toBe(true);
    expect(ics.replace(/\r\n/g, "")).not.toMatch(/[\r\n]/);
    for (const line of ics.split("\r\n")) expect(Buffer.byteLength(line, "utf8")).toBeLessThanOrEqual(75);
  });

  it("writes UTC start and end times, a UID and an escaped summary", () => {
    const lines = unfold(buildIcs(event));
    expect(lines).toContain("BEGIN:VCALENDAR");
    expect(lines).toContain("VERSION:2.0");
    expect(lines).toContain("METHOD:PUBLISH");
    expect(lines).toContain("DTSTART:20261107T040000Z");
    expect(lines).toContain("DTEND:20261107T053000Z");
    expect(lines).toContain("DTSTAMP:20261023T120000Z");
    expect(lines).toContain(`UID:${event.uid}`);
    expect(lines).toContain("SUMMARY:Dinner at Halcyon\\, Window 1");
    expect(lines).toContain("LOCATION:Halcyon\\, 1 Harbor Walk\\, Demo Bay\\, CA");
    expect(lines).toContain(`DESCRIPTION:${icsEscape(event.description)}`);
    expect(lines).toContain(`URL:${event.url}`);
    expect(lines).toContain("STATUS:CONFIRMED");
    expect(lines.indexOf("BEGIN:VEVENT")).toBeLessThan(lines.indexOf("END:VEVENT"));
    expect(lines.at(-2)).toBe("END:VCALENDAR");
    expect(buildIcs({ ...event, status: "CANCELLED" })).toContain("METHOD:CANCEL\r\n");
  });

  it("escapes backslashes, semicolons, commas and newlines", () => {
    expect(icsEscape("a\\b;c,d\ne\r\nf")).toBe("a\\\\b\\;c\\,d\\ne\\nf");
  });

  it("never splits a multi-byte character when folding", () => {
    const line = `SUMMARY:${"Café crème brûlée ".repeat(8)}`;
    const folded = icsFold(line);
    for (const part of folded.split("\r\n")) {
      expect(Buffer.byteLength(part, "utf8")).toBeLessThanOrEqual(75);
      expect(part).not.toContain("�");
    }
    expect(folded.replace(/\r\n /g, "")).toBe(line);
  });

  it("formats dates as basic UTC", () => {
    expect(icsDate(new Date("2027-03-14T09:45:00.000Z"))).toBe("20270314T094500Z");
  });
});
