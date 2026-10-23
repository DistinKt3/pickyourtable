import "server-only";
import { type EmailAttachment, sendEmail } from "@/lib/email/index";
import {
  bookingCancelledEmail,
  bookingConfirmedEmail,
  type EmailBooking,
  latePaymentRefundedEmail,
  seatedElsewhereEmail,
} from "@/lib/email/templates/guest";
import type { EmailVenue, RenderedEmail } from "@/lib/email/templates/layout";
import { type VenueEmailBooking, venueCancelledBookingEmail, venueNewBookingEmail } from "@/lib/email/templates/venue";
import { formatDate, formatDateLong, formatTime, occasionLabel, partyLabel } from "@/lib/format";
import { log } from "@/lib/log";
import { seatViewImage } from "@/lib/venue/media";
import { type BookingVenue, daypartName, tierName } from "./context";
import { buildIcs } from "./ics";
import { absoluteUrl, manageToken, manageUrl, venueUrl } from "./links";
import type { LoadedBooking } from "./load";
import { slotParts } from "./slots";
import { cardWords } from "./views";

/**
 * Booking emails (PRD G-8, O-2, O-5, S-3). Sending never fails the operation that
 * caused it: the state change is already committed, so a failed send is logged and the
 * host can resend the confirmation from the portal.
 */

export function emailVenue(v: BookingVenue): EmailVenue {
  return {
    id: v.id,
    name: v.name,
    accent: v.json.brand.accent,
    onAccent: v.json.brand.onAccent,
    demo: v.json.demo,
    address: v.json.contact.address,
    phone: v.json.contact.phone,
    email: v.json.contact.email,
  };
}

async function emailBooking(b: LoadedBooking): Promise<EmailBooking & { token: string }> {
  const { date, time } = slotParts(b.r.startsAt, b.v.timezone);
  const token = await manageToken(b.r, b.v.timezone);
  return {
    token,
    tableLabel: b.table.label,
    tierName: tierName(b.v, b.table.tier),
    dateLong: formatDateLong(date),
    dateShort: formatDate(date),
    time: formatTime(time),
    daypartName: daypartName(b.v, b.r.daypart),
    partyLabel: partyLabel(b.r.partySize),
    priceCents: b.r.priceCents,
    cardWords: cardWords(b.r.cardBrand, b.r.cardLast4),
    seatViewUrl: absoluteUrl(seatViewImage(b.v.id, { id: b.table.code, photoId: b.table.photoId }).email),
    manageUrl: manageUrl(b.v.id, token),
    fullRefundHours: b.v.json.booking.fullRefundHours,
  };
}

function venueBooking(b: LoadedBooking, eb: EmailBooking): VenueEmailBooking {
  return {
    tableLabel: eb.tableLabel,
    tierName: eb.tierName,
    dateLong: eb.dateLong,
    dateShort: eb.dateShort,
    time: eb.time,
    partySize: b.r.partySize,
    partyLabel: eb.partyLabel,
    priceCents: b.r.priceCents,
    guestName: b.guest?.name ?? "Guest",
    guestEmail: b.guest?.email ?? "",
    guestMobile: b.guest?.mobile ?? "",
    occasion: occasionLabel(b.guest?.occasion),
    note: b.guest?.note ?? null,
    portalUrl: absoluteUrl("/portal"),
  };
}

/** The booking's calendar file (RFC 5545). */
export function calendarFile(b: LoadedBooking, link: string): string {
  const daypart = daypartName(b.v, b.r.daypart);
  const status = b.r.status === "cancelled" || b.r.status === "expired" ? "CANCELLED" : "CONFIRMED";
  return buildIcs({
    uid: `${b.r.id}@${new URL(absoluteUrl("/")).hostname}`,
    start: b.r.startsAt,
    end: b.r.endsAt,
    summary: `${daypart} at ${b.v.name}, ${b.table.label}`,
    location: `${b.v.name}, ${b.v.json.contact.address}`,
    description: `${b.table.label} for ${partyLabel(b.r.partySize)}. View or cancel your booking: ${link}`,
    url: link,
    organizerName: b.v.name,
    status,
  });
}

export function calendarFileName(b: LoadedBooking): string {
  return `${b.v.id}-${slotParts(b.r.startsAt, b.v.timezone).date}.ics`;
}

async function send(
  b: LoadedBooking,
  to: string | null | undefined,
  tag: string,
  mail: RenderedEmail,
  attachments: EmailAttachment[] = [],
): Promise<boolean> {
  if (!to) {
    log.warn("email.skipped", { tag, reservationId: b.r.id, reason: "no_recipient" });
    return false;
  }
  try {
    await sendEmail({ to, subject: mail.subject, html: mail.html, text: mail.text, tag, reservationId: b.r.id, attachments });
    return true;
  } catch (e) {
    log.error("email.failed", { tag, reservationId: b.r.id, error: e });
    return false;
  }
}

/** Guest confirmation with the seat view and the calendar file (G-8). */
export async function sendBookingConfirmed(b: LoadedBooking): Promise<boolean> {
  const eb = await emailBooking(b);
  const ics = calendarFile(b, eb.manageUrl);
  return send(b, b.guest?.email, "booking-confirmed", bookingConfirmedEmail(emailVenue(b.v), eb), [
    {
      name: calendarFileName(b),
      contentType: "text/calendar; charset=utf-8; method=PUBLISH",
      content: Buffer.from(ics).toString("base64"),
    },
  ]);
}

/** New paid booking, to the venue's contact address (O-5). */
export async function sendVenueNewBooking(b: LoadedBooking): Promise<boolean> {
  const eb = await emailBooking(b);
  return send(b, b.v.json.contact.email, "venue-booking-new", venueNewBookingEmail(emailVenue(b.v), venueBooking(b, eb)));
}

/** Cancellation emails to the guest and the venue (G-9, O-2, O-5). */
export async function sendBookingCancelled(
  b: LoadedBooking,
  opts: { by: "guest" | "venue"; refundCents: number },
): Promise<void> {
  const eb = await emailBooking(b);
  const venue = emailVenue(b.v);
  await send(b, b.guest?.email, "booking-cancelled", bookingCancelledEmail(venue, eb, opts));
  await send(b, b.v.json.contact.email, "venue-booking-cancelled", venueCancelledBookingEmail(venue, venueBooking(b, eb), opts));
}

/** S-3: the payment came after the hold ended and the table was taken, so it was refunded. */
export async function sendLatePaymentRefunded(b: LoadedBooking): Promise<boolean> {
  const eb = await emailBooking(b);
  return send(
    b,
    b.guest?.email,
    "late-payment-refunded",
    latePaymentRefundedEmail(emailVenue(b.v), { ...eb, holdMinutes: b.v.json.booking.holdMinutes, venueUrl: venueUrl(b.v.id) }),
  );
}

export async function sendSeatedElsewhere(b: LoadedBooking, seatedLabel: string): Promise<boolean> {
  const eb = await emailBooking(b);
  return send(b, b.guest?.email, "seated-elsewhere-refund", seatedElsewhereEmail(emailVenue(b.v), { ...eb, seatedLabel }));
}
