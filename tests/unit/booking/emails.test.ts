import { describe, expect, it } from "vitest";
import {
  bookingCancelledEmail,
  bookingConfirmedEmail,
  type EmailBooking,
  latePaymentRefundedEmail,
  seatedElsewhereEmail,
} from "@/lib/email/templates/guest";
import type { EmailVenue, RenderedEmail } from "@/lib/email/templates/layout";
import { venueCancelledBookingEmail, venueNewBookingEmail } from "@/lib/email/templates/venue";

const venue: EmailVenue = {
  id: "halcyon",
  name: "Halcyon",
  accent: "#1F5A63",
  onAccent: "#FFFFFF",
  demo: true,
  address: "1 Harbor Walk, Demo Bay, CA",
  phone: "(415) 555-0142",
  email: "reservations@halcyon.example",
};

const booking: EmailBooking = {
  tableLabel: "Window 1",
  tierName: "Window",
  dateLong: "Friday, November 6",
  dateShort: "Fri, Nov 6",
  time: "8:00 pm",
  daypartName: "Dinner",
  partyLabel: "2 guests",
  priceCents: 4000,
  cardWords: "Visa ending 4242",
  seatViewUrl: "https://pyt.example/venues/halcyon/renders/W1-email.jpg",
  manageUrl: "https://pyt.example/v/halcyon/manage/abc.def.ghi",
  fullRefundHours: 24,
};

const hostile = {
  tableLabel: "Window 1",
  tierName: "Window",
  dateLong: "Friday, November 6",
  dateShort: "Fri, Nov 6",
  time: "8:00 pm",
  partySize: 2,
  partyLabel: "2 guests",
  priceCents: 4000,
  guestName: '<script>alert("x")</script> Robin',
  guestEmail: "robin@example.com",
  guestMobile: "+1 415 555 0100",
  occasion: "Anniversary",
  note: '<img src=x onerror="steal()"> & "quotes"',
  portalUrl: "https://pyt.example/portal",
};

const guestEmails: [string, RenderedEmail][] = [
  ["confirmed", bookingConfirmedEmail(venue, booking)],
  ["cancelled by guest", bookingCancelledEmail(venue, booking, { by: "guest", refundCents: 4000 })],
  ["cancelled by venue", bookingCancelledEmail(venue, booking, { by: "venue", refundCents: 4000 })],
  ["cancelled late", bookingCancelledEmail(venue, booking, { by: "guest", refundCents: 0 })],
  ["late payment", latePaymentRefundedEmail(venue, { ...booking, holdMinutes: 8, venueUrl: "https://pyt.example/v/halcyon" })],
  ["seated elsewhere", seatedElsewhereEmail(venue, { ...booking, seatedLabel: "Table 12" })],
];
const venueEmails: [string, RenderedEmail][] = [
  ["venue new", venueNewBookingEmail(venue, hostile)],
  ["venue cancelled", venueCancelledBookingEmail(venue, hostile, { by: "guest", refundCents: 0 })],
];

describe("booking emails", () => {
  it.each([...guestEmails, ...venueEmails])("%s: venue branding only, plain words, HTML and text", (_name, mail) => {
    for (const part of [mail.subject, mail.html, mail.text]) {
      expect(part).not.toMatch(/pick-?your-?table/i);
      expect(part).not.toMatch(/\p{Extended_Pictographic}/u);
    }
    expect(mail.subject).not.toContain("!");
    expect(mail.text).not.toContain("!");
    expect(mail.html).toContain("Halcyon");
    expect(mail.html).toContain("background:#1F5A63");
    expect(mail.html).toContain('<table role="presentation"');
    expect(mail.html).toContain("Demo venue.");
    expect(mail.text).toContain("Demo venue.");
    expect(mail.text.trim().length).toBeGreaterThan(40);
  });

  it("the confirmation carries the seat view, details, policy and manage link", () => {
    const mail = bookingConfirmedEmail(venue, booking);
    expect(mail.subject).toBe("Your table at Halcyon is booked for Fri, Nov 6 at 8:00 pm");
    expect(mail.html).toContain('src="https://pyt.example/venues/halcyon/renders/W1-email.jpg"');
    expect(mail.html).toContain('alt="The view from Window 1"');
    expect(mail.html).toContain('href="https://pyt.example/v/halcyon/manage/abc.def.ghi"');
    for (const s of ["Window 1 (Window)", "Friday, November 6", "8:00 pm", "2 guests", "$40, Visa ending 4242"]) {
      expect(mail.html).toContain(s);
      expect(mail.text).toContain(s);
    }
    expect(mail.text).toContain("Cancel 24 hours or more before your booking for a full refund");
  });

  it("refund wording follows the amount", () => {
    expect(bookingCancelledEmail(venue, booking, { by: "guest", refundCents: 4000 }).text).toContain(
      "We have refunded $40 to your Visa ending 4242.",
    );
    expect(bookingCancelledEmail(venue, booking, { by: "guest", refundCents: 0 }).text).toContain(
      "so the $40 table fee is not refunded.",
    );
    expect(bookingCancelledEmail(venue, booking, { by: "venue", refundCents: 4000 }).text).toContain(
      "Halcyon has cancelled your booking for Window 1",
    );
  });

  it("escapes every interpolated value", () => {
    for (const [, mail] of venueEmails) {
      expect(mail.html).not.toContain("<script>");
      expect(mail.html).not.toContain("<img src=x");
      expect(mail.html).toContain("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; Robin");
      expect(mail.html).not.toMatch(/onerror="/);
    }
    const sneaky = bookingConfirmedEmail({ ...venue, name: 'Halcyon "><b>' }, { ...booking, tableLabel: "W<1>" });
    expect(sneaky.html).not.toContain('"><b>');
    expect(sneaky.html).toContain("W&lt;1&gt;");
  });

  it("no demo note for a real venue", () => {
    expect(bookingConfirmedEmail({ ...venue, demo: false }, booking).html).not.toContain("Demo venue");
  });
});
