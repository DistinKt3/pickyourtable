import "server-only";
import { eq } from "drizzle-orm";
import { db, type Queryable } from "@/db/client";
import { guest, reservation } from "@/db/schema";
import { type BookingTable, type BookingVenue, loadBookingVenue } from "./context";
import { type GuestRow, type ReservationRow, tableOf } from "./views";

/** One reservation with its venue, table and guest, as most booking paths need it. */
export interface LoadedBooking {
  r: ReservationRow;
  v: BookingVenue;
  table: BookingTable;
  guest: (GuestRow & { id: string }) | null;
}

export async function loadGuest(id: string | null, q: Queryable = db()): Promise<(GuestRow & { id: string }) | null> {
  if (!id) return null;
  const [g] = await q.select().from(guest).where(eq(guest.id, id));
  return g ? { id: g.id, name: g.name, email: g.email, mobile: g.mobile, occasion: g.occasion, note: g.note } : null;
}

export async function loadBooking(
  reservationId: string,
  opts: { q?: Queryable; venue?: BookingVenue } = {},
): Promise<LoadedBooking | null> {
  const q = opts.q ?? db();
  const [r] = await q.select().from(reservation).where(eq(reservation.id, reservationId));
  if (!r) return null;
  const v = opts.venue?.id === r.venueId ? opts.venue : await loadBookingVenue(r.venueId, q);
  if (!v) return null;
  return { r, v, table: tableOf(v, r.tableId), guest: await loadGuest(r.guestId, q) };
}

export async function loadBookingByIntent(paymentIntentId: string): Promise<LoadedBooking | null> {
  const [r] = await db().select({ id: reservation.id }).from(reservation).where(eq(reservation.paymentIntentId, paymentIntentId));
  return r ? loadBooking(r.id) : null;
}
