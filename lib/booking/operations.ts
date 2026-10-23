import "server-only";
import type { BookingsResponse, PortalReservation, TonightResponse } from "@/lib/api/contracts";

/**
 * Reservation operations the operator portal calls. The booking service owns their
 * implementation (state machine, refunds, emails, audit log); portal route handlers
 * only authenticate, authorize and call these.
 *
 * Every function checks that the reservation belongs to `venueId`, so one venue's
 * operator can never act on another venue's booking.
 */

export interface Actor {
  type: "guest" | "operator" | "system";
  id: string | null;
}

export interface ReservationResult {
  reservation: PortalReservation;
  refundCents: number;
}

export class OperationError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

function notYet(): never {
  throw new OperationError(501, "not_implemented", "Not implemented yet.");
}

/** Today's (or `date`'s) paid bookings and table states for the Tonight screen (PRD O-1). */
export async function listTonight(_args: { venueId: string; date?: string }): Promise<TonightResponse> {
  return notYet();
}

export async function listBookings(_args: {
  venueId: string;
  q?: string;
  status: "upcoming" | "past" | "cancelled" | "all";
  from?: string;
  to?: string;
}): Promise<BookingsResponse> {
  return notYet();
}

/**
 * Marks a confirmed booking seated. Seating at a different table than the one paid
 * for refunds the full fee automatically (PRD product decisions).
 */
export async function seatReservation(_args: {
  venueId: string;
  reservationId: string;
  tableCode?: string;
  actor: Actor;
}): Promise<ReservationResult> {
  return notYet();
}

/** No-show: no refund (PRD refunds). */
export async function markNoShow(_args: { venueId: string; reservationId: string; actor: Actor }): Promise<ReservationResult> {
  return notYet();
}

/** Puts a seated or no-show booking back to confirmed, when no refund has been issued. */
export async function undoArrival(_args: { venueId: string; reservationId: string; actor: Actor }): Promise<ReservationResult> {
  return notYet();
}

/** Venue-initiated cancellation: full refund and an email to the guest (PRD O-2). */
export async function cancelByVenue(_args: {
  venueId: string;
  reservationId: string;
  reason: string;
  actor: Actor;
}): Promise<ReservationResult> {
  return notYet();
}

export async function resendConfirmation(_args: { venueId: string; reservationId: string; actor: Actor }): Promise<void> {
  return notYet();
}
