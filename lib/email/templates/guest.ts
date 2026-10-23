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

/**
 * Emails to the guest (PRD G-8, G-9, O-2, S-3 and the seated-elsewhere refund). Plain
 * words, sentence case, no exclamation marks. The guest only ever sees the venue.
 */

export interface EmailBooking {
  tableLabel: string;
  tierName: string;
  /** "Friday, October 30" */
  dateLong: string;
  /** "Fri, Oct 30" */
  dateShort: string;
  /** "8:00 pm" */
  time: string;
  /** "Dinner" */
  daypartName: string;
  partyLabel: string;
  priceCents: number;
  /** "Visa ending 4242" */
  cardWords: string | null;
  seatViewUrl: string;
  manageUrl: string;
  fullRefundHours: number;
}

function when(b: EmailBooking): string {
  return `${b.dateShort} at ${b.time}`;
}

function bookingRows(b: EmailBooking): [string, string][] {
  return [
    ["Table", `${b.tableLabel} (${b.tierName})`],
    ["Date", b.dateLong],
    ["Time", b.time],
    ["Party", b.partyLabel],
  ];
}

const REFUND_TIMING = "Refunds usually reach your account in 5 to 10 business days.";

export function bookingConfirmedEmail(v: EmailVenue, b: EmailBooking): RenderedEmail {
  const subject = `Your table at ${v.name} is booked for ${when(b)}`;
  const fee = b.cardWords ? `${formatMoney(b.priceCents)}, ${b.cardWords}` : formatMoney(b.priceCents);
  const rows: [string, string][] = [...bookingRows(b), ["Table fee paid", fee]];
  const policy = `Cancel ${b.fullRefundHours} hours or more before your booking for a full refund of the table fee. Cancellations after that, and no-shows, are not refunded.`;
  const html = layout(v, {
    subject,
    preheader: `${b.tableLabel}, ${b.dateLong} at ${b.time}, ${b.partyLabel}.`,
    image: { src: b.seatViewUrl, alt: `The view from ${b.tableLabel}` },
    body: [
      heading(`${b.tableLabel} is yours`),
      paragraph(`Your ${esc(b.daypartName.toLowerCase())} table at ${esc(v.name)} is booked. This is the view from your seat.`),
      details(rows),
      paragraph("The table fee guarantees this exact table. It is separate from your bill for the meal."),
      paragraph(esc(policy)),
      button(v, b.manageUrl, "View or cancel your booking"),
      paragraph("A calendar file for this booking is attached."),
    ].join(""),
  });
  const text = textPart(v, [
    `${b.tableLabel} is yours`,
    `Your ${b.daypartName.toLowerCase()} table at ${v.name} is booked.`,
    textDetails(rows),
    "The table fee guarantees this exact table. It is separate from your bill for the meal.",
    policy,
    `View or cancel your booking: ${b.manageUrl}`,
    "A calendar file for this booking is attached.",
  ]);
  return { subject, html, text };
}

export function bookingCancelledEmail(
  v: EmailVenue,
  b: EmailBooking,
  opts: { by: "guest" | "venue"; refundCents: number },
): RenderedEmail {
  const subject = `Your booking at ${v.name} is cancelled`;
  const lead =
    opts.by === "venue"
      ? `${v.name} has cancelled your booking for ${b.tableLabel} on ${b.dateLong} at ${b.time}. We are sorry for the change of plans.`
      : `Your booking for ${b.tableLabel} on ${b.dateLong} at ${b.time} is cancelled.`;
  const refund =
    opts.refundCents > 0
      ? `We have refunded ${formatMoney(opts.refundCents)}${b.cardWords ? ` to your ${b.cardWords}` : ""}. ${REFUND_TIMING}`
      : `This booking was cancelled less than ${b.fullRefundHours} hours before it started, so the ${formatMoney(b.priceCents)} table fee is not refunded.`;
  const html = layout(v, {
    subject,
    preheader: opts.refundCents > 0 ? `Refund of ${formatMoney(opts.refundCents)}.` : "No refund is due for this cancellation.",
    body: [heading("Your booking is cancelled"), paragraph(esc(lead)), details(bookingRows(b)), paragraph(esc(refund))].join(""),
  });
  const text = textPart(v, ["Your booking is cancelled", lead, textDetails(bookingRows(b)), refund]);
  return { subject, html, text };
}

/** PRD S-3: the payment arrived after the hold ended and another guest had the table. */
export function latePaymentRefundedEmail(
  v: EmailVenue,
  b: EmailBooking & { holdMinutes: number; venueUrl: string },
): RenderedEmail {
  const subject = `We could not keep your table at ${v.name}`;
  const lead = `Your payment for ${b.tableLabel} on ${b.dateLong} at ${b.time} arrived after your ${b.holdMinutes}-minute hold ended, and another guest booked the table in the meantime.`;
  const refund = `We have refunded the full ${formatMoney(b.priceCents)}${b.cardWords ? ` to your ${b.cardWords}` : ""}. ${REFUND_TIMING}`;
  const html = layout(v, {
    subject,
    preheader: `Your ${formatMoney(b.priceCents)} payment has been refunded in full.`,
    body: [
      heading("We could not keep your table"),
      paragraph(esc(lead)),
      paragraph(esc(refund)),
      paragraph("You are welcome to choose another table."),
      button(v, b.venueUrl, "Choose another table"),
    ].join(""),
  });
  const text = textPart(v, [
    "We could not keep your table",
    lead,
    refund,
    "You are welcome to choose another table.",
    `Choose another table: ${b.venueUrl}`,
  ]);
  return { subject, html, text };
}

/** Seated at a different table than the one paid for: the fee comes back in full. */
export function seatedElsewhereEmail(v: EmailVenue, b: EmailBooking & { seatedLabel: string }): RenderedEmail {
  const subject = `Your table fee at ${v.name} has been refunded`;
  const lead = `You were seated at ${b.seatedLabel} instead of ${b.tableLabel}, the table you booked for ${b.dateLong} at ${b.time}.`;
  const refund = `We have refunded the full ${formatMoney(b.priceCents)} table fee${b.cardWords ? ` to your ${b.cardWords}` : ""}. ${REFUND_TIMING}`;
  const html = layout(v, {
    subject,
    preheader: `Your ${formatMoney(b.priceCents)} table fee has been refunded in full.`,
    body: [heading("Your table fee is refunded"), paragraph(esc(lead)), paragraph(esc(refund))].join(""),
  });
  const text = textPart(v, ["Your table fee is refunded", lead, refund]);
  return { subject, html, text };
}
