/**
 * A calendar file for one booking, written by hand to RFC 5545 (see DECISIONS: no
 * `ics` package). Lines end in CRLF and fold at 75 octets; text values are escaped;
 * times are UTC.
 */

export interface CalendarEvent {
  uid: string;
  start: Date;
  end: Date;
  summary: string;
  location: string;
  description: string;
  url?: string;
  /** Who publishes the file; shown by some calendar apps. */
  organizerName: string;
  status: "CONFIRMED" | "CANCELLED";
  /** DTSTAMP; defaults to now. */
  stamp?: Date;
}

export function icsDate(d: Date): string {
  return d
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}/, "");
}

/** Escapes a TEXT value: backslash, semicolon, comma and newlines. */
export function icsEscape(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r\n|\r|\n/g, "\\n");
}

/** Folds a content line to at most 75 octets per line, never splitting a UTF-8 character. */
export function icsFold(line: string): string {
  const out: string[] = [];
  let current = "";
  let bytes = 0;
  for (const ch of line) {
    const size = Buffer.byteLength(ch, "utf8");
    // Continuation lines start with one space, which counts toward their 75 octets.
    const limit = out.length === 0 ? 75 : 74;
    if (bytes + size > limit) {
      out.push(current);
      current = "";
      bytes = 0;
    }
    current += ch;
    bytes += size;
  }
  out.push(current);
  return out.join("\r\n ");
}

export function buildIcs(e: CalendarEvent): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    `PRODID:-//${icsEscape(e.organizerName)}//Table booking//EN`,
    "CALSCALE:GREGORIAN",
    `METHOD:${e.status === "CANCELLED" ? "CANCEL" : "PUBLISH"}`,
    "BEGIN:VEVENT",
    `UID:${e.uid}`,
    `DTSTAMP:${icsDate(e.stamp ?? new Date())}`,
    `DTSTART:${icsDate(e.start)}`,
    `DTEND:${icsDate(e.end)}`,
    `SUMMARY:${icsEscape(e.summary)}`,
    `LOCATION:${icsEscape(e.location)}`,
    `DESCRIPTION:${icsEscape(e.description)}`,
    ...(e.url ? [`URL:${e.url}`] : []),
    `STATUS:${e.status}`,
    "TRANSP:OPAQUE",
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return `${lines.map(icsFold).join("\r\n")}\r\n`;
}
