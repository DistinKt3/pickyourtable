import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { reservation } from "@/db/schema";
import type { BookingDetails, ManageResponse, RefundPreview } from "@/lib/api/contracts";
import { formatMoney } from "@/lib/format";
import { ApiError } from "@/lib/http/api";
import { log } from "@/lib/log";
import { safeEqual } from "@/lib/security/crypto";
import { verifyToken } from "@/lib/security/tokens";
import { audit } from "./audit";
import { tierName } from "./context";
import { calendarPath, manageUrl } from "./links";
import { type LoadedBooking, loadBooking } from "./load";
import { calendarFile, calendarFileName, sendBookingCancelled } from "./notify";
import { refundPolicy, refundPreviewFor } from "./policy";
import { settleRefund } from "./refunds";
import { slotViewOf } from "./views";

/**
 * The guest's manage link (PRD G-9 and the red-team case "one guest's manage link used
 * to cancel another booking"). The token alone identifies the booking: no reservation id
 * is ever taken from the client. Verification checks the signature, the audience, the
 * expiry, and that the nonce still matches the row.
 */

const INVALID = "This link is not valid. Use the link in your confirmation email.";

export async function bookingForToken(token: string): Promise<LoadedBooking> {
  const res = await verifyToken("manage", token);
  if (!res.ok) {
    throw res.reason === "expired"
      ? new ApiError(410, "link_expired", "This link has expired because the booking date has passed.")
      : new ApiError(401, "invalid_link", INVALID);
  }
  const b = await loadBooking(res.claims.sub);
  if (!b || !res.claims.nonce || !safeEqual(res.claims.nonce, b.r.manageNonce)) throw new ApiError(401, "invalid_link", INVALID);
  // A hold that never became a booking has nothing to manage.
  if (!b.r.confirmedAt) throw new ApiError(404, "booking_not_found", "We could not find this booking.");
  return b;
}

function detailsOf(b: LoadedBooking): BookingDetails {
  return {
    id: b.r.id,
    venueId: b.v.id,
    venueName: b.v.name,
    table: b.table.code,
    tableLabel: b.table.label,
    tier: b.table.tier,
    tierName: tierName(b.v, b.table.tier),
    partySize: b.r.partySize,
    slot: slotViewOf(b.v, b.r),
    priceCents: b.r.priceCents,
    currency: "usd",
    status: b.r.status,
    guestName: b.guest?.name ?? "Guest",
    guestEmail: b.guest?.email ?? "",
    occasion: b.guest?.occasion ?? null,
    note: b.guest?.note ?? null,
    cardBrand: b.r.cardBrand,
    cardLast4: b.r.cardLast4,
    refundCents: Math.max(b.r.refundCents, b.r.refundDueCents),
  };
}

function canCancel(b: LoadedBooking, now: Date): boolean {
  return b.r.status === "confirmed" && b.r.startsAt.getTime() > now.getTime();
}

function previewFor(b: LoadedBooking, now: Date): RefundPreview {
  const refunded = Math.max(b.r.refundCents, b.r.refundDueCents);
  switch (b.r.status) {
    case "cancelled":
      return {
        policy: refunded > 0 ? "full" : "none",
        amountCents: refunded,
        explanation:
          refunded > 0
            ? `This booking is cancelled. ${formatMoney(refunded)} was refunded.`
            : "This booking is cancelled. No refund was due.",
      };
    case "seated":
      return { policy: "none", amountCents: 0, explanation: "This booking has been used, so it can no longer be cancelled." };
    case "no_show":
      return { policy: "none", amountCents: 0, explanation: "This booking time has passed, so it can no longer be cancelled." };
    default:
      if (!canCancel(b, now)) {
        return { policy: "none", amountCents: 0, explanation: "This booking time has passed, so it can no longer be cancelled." };
      }
      return refundPreviewFor({
        startsAt: b.r.startsAt,
        now,
        priceCents: b.r.priceCents,
        refundedCents: refunded,
        fullRefundHours: b.v.json.booking.fullRefundHours,
        timeZone: b.v.timezone,
      });
  }
}

export async function manageView(token: string, now = new Date()): Promise<ManageResponse> {
  const b = await bookingForToken(token);
  return { booking: detailsOf(b), refund: previewFor(b, now), canCancel: canCancel(b, now), calendarUrl: calendarPath(token) };
}

/** Cancels with the refund the policy gives at this moment, recomputed here, not taken from the preview. */
export async function cancelByGuest(token: string, now = new Date()): Promise<{ status: "cancelled"; refundCents: number }> {
  const b = await bookingForToken(token);
  if (!canCancel(b, now)) {
    throw new ApiError(
      409,
      "cannot_cancel",
      b.r.status === "cancelled" ? "This booking is already cancelled." : "This booking can no longer be cancelled.",
    );
  }
  const policy = refundPolicy({
    startsAt: b.r.startsAt,
    now,
    priceCents: b.r.priceCents,
    refundedCents: Math.max(b.r.refundCents, b.r.refundDueCents),
    fullRefundHours: b.v.json.booking.fullRefundHours,
  });
  const target = b.r.refundDueCents + policy.amountCents;

  const changed = await db().transaction(async (tx) => {
    const rows = await tx
      .update(reservation)
      .set({
        status: "cancelled",
        cancelledAt: new Date(),
        cancelReason: "guest",
        refundDueCents: sql`LEAST(${reservation.priceCents}, GREATEST(${reservation.refundDueCents}, ${target}::int))`,
        updatedAt: new Date(),
      })
      .where(and(eq(reservation.id, b.r.id), eq(reservation.status, "confirmed")))
      .returning({ id: reservation.id });
    if (!rows.length) return false;
    await audit(
      {
        venueId: b.v.id,
        actor: { type: "guest", id: null },
        action: "booking.cancelled",
        reservationId: b.r.id,
        amountCents: policy.amountCents,
        details: { by: "guest", policy: policy.policy },
      },
      tx,
    );
    return true;
  });
  if (!changed) throw new ApiError(409, "cannot_cancel", "This booking can no longer be cancelled.");

  if (policy.amountCents > 0) await settleRefund(b.r.id, { reason: "requested_by_customer" });
  log.info("booking.cancelled", {
    reservationId: b.r.id,
    venueId: b.v.id,
    by: "guest",
    priceCents: b.r.priceCents,
    refundCents: policy.amountCents,
    outcome: policy.policy,
  });
  const fresh = await loadBooking(b.r.id, { venue: b.v });
  if (fresh) await sendBookingCancelled(fresh, { by: "guest", refundCents: policy.amountCents });
  return { status: "cancelled", refundCents: policy.amountCents };
}

export async function calendarForToken(token: string): Promise<{ body: string; filename: string }> {
  const b = await bookingForToken(token);
  return { body: calendarFile(b, manageUrl(b.v.id, token)), filename: calendarFileName(b) };
}
