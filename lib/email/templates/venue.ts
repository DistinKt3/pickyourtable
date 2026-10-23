import { esc } from "@/lib/email/index";
import { formatMoney } from "@/lib/format";
import {
  button,
  details,
  type EmailVenue,
  heading,
  layout,
  paragraph,
  type RenderedEmail,
  textDetails,
  textPart,
} from "./layout";

/** Notifications to the venue's contact address for new and cancelled bookings (PRD O-5). */

export interface VenueEmailBooking {
  tableLabel: string;
  tierName: string;
  dateLong: string;
  dateShort: string;
  time: string;
  partySize: number;
  partyLabel: string;
  priceCents: number;
  guestName: string;
  guestEmail: string;
  guestMobile: string;
  occasion: string | null;
  note: string | null;
  portalUrl: string;
}

function rows(b: VenueEmailBooking): [string, string][] {
  return [
    ["Table", `${b.tableLabel} (${b.tierName})`],
    ["Date", b.dateLong],
    ["Time", b.time],
    ["Party", b.partyLabel],
    ["Guest", b.guestName],
    ["Email", b.guestEmail],
    ["Mobile", b.guestMobile],
    ...(b.occasion ? ([["Occasion", b.occasion]] as [string, string][]) : []),
    ...(b.note ? ([["Note", b.note]] as [string, string][]) : []),
  ];
}

export function venueNewBookingEmail(v: EmailVenue, b: VenueEmailBooking): RenderedEmail {
  const subject = `New booking: ${b.tableLabel}, ${b.dateShort} at ${b.time}, party of ${b.partySize}`;
  const lead = `${b.guestName} paid ${formatMoney(b.priceCents)} to book ${b.tableLabel}.`;
  const html = layout(v, {
    subject,
    preheader: lead,
    body: [
      heading("New paid booking"),
      paragraph(esc(lead)),
      details(rows(b)),
      button(v, b.portalUrl, "Open tonight's bookings"),
    ].join(""),
  });
  const text = textPart(v, ["New paid booking", lead, textDetails(rows(b)), `Open the venue portal: ${b.portalUrl}`]);
  return { subject, html, text };
}

export function venueCancelledBookingEmail(
  v: EmailVenue,
  b: VenueEmailBooking,
  opts: { by: "guest" | "venue"; refundCents: number },
): RenderedEmail {
  const subject = `Booking cancelled: ${b.tableLabel}, ${b.dateShort} at ${b.time}`;
  const who = opts.by === "guest" ? `${b.guestName} cancelled this booking.` : "Your team cancelled this booking.";
  const refund =
    opts.refundCents > 0
      ? `The guest was refunded ${formatMoney(opts.refundCents)}.`
      : "No refund was due under the cancellation policy.";
  const html = layout(v, {
    subject,
    preheader: `${who} ${refund}`,
    body: [
      heading("Booking cancelled"),
      paragraph(esc(`${who} ${refund}`)),
      details(rows(b)),
      paragraph(`${esc(b.tableLabel)} is free again for that time.`),
      button(v, b.portalUrl, "Open bookings"),
    ].join(""),
  });
  const text = textPart(v, [
    "Booking cancelled",
    `${who} ${refund}`,
    textDetails(rows(b)),
    `${b.tableLabel} is free again for that time.`,
    `Open the venue portal: ${b.portalUrl}`,
  ]);
  return { subject, html, text };
}
