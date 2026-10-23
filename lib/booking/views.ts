import "server-only";
import type { DayType, reservation } from "@/db/schema";
import type { HoldView, PortalReservation, SlotView } from "@/lib/api/contracts";
import { type BookingTable, type BookingVenue, daypartName } from "./context";
import { type Slot, slotParts } from "./slots";

/** Response shapes built from stored rows, so every endpoint describes a booking the same way. */

export type ReservationRow = typeof reservation.$inferSelect;

export interface GuestRow {
  name: string;
  email: string;
  mobile: string;
  occasion: string | null;
  note: string | null;
}

export function slotViewOf(v: BookingVenue, r: { startsAt: Date; endsAt: Date; daypart: string; dayType: DayType }): SlotView {
  const { date, time } = slotParts(r.startsAt, v.timezone);
  return {
    date,
    time,
    startsAt: r.startsAt.toISOString(),
    endsAt: r.endsAt.toISOString(),
    daypart: r.daypart,
    daypartName: daypartName(v, r.daypart),
    dayType: r.dayType,
  };
}

export function slotViewFromSlot(slot: Slot, endsAt: Date, dayType: DayType): SlotView {
  return {
    date: slot.date,
    time: slot.time,
    startsAt: slot.startsAt.toISOString(),
    endsAt: endsAt.toISOString(),
    daypart: slot.daypart,
    daypartName: slot.daypartName,
    dayType,
  };
}

export function tableOf(v: BookingVenue, tableId: string): BookingTable {
  const t = v.byId.get(tableId);
  if (!t) throw new Error(`table ${tableId} is not in venue ${v.id}`);
  return t;
}

export function holdViewOf(v: BookingVenue, r: ReservationRow): HoldView {
  const t = tableOf(v, r.tableId);
  return {
    id: r.id,
    venueId: v.id,
    table: t.code,
    tableLabel: t.label,
    tier: t.tier,
    partySize: r.partySize,
    slot: slotViewOf(v, r),
    priceCents: r.priceCents,
    currency: "usd",
    expiresAt: (r.holdExpiresAt ?? r.createdAt).toISOString(),
    status: r.status,
  };
}

/** The fee is paid and still kept by the venue (not refunded). */
export function isPaid(r: Pick<ReservationRow, "confirmedAt" | "refundDueCents" | "priceCents" | "status">): boolean {
  return r.confirmedAt !== null && r.refundDueCents < r.priceCents && r.status !== "held" && r.status !== "expired";
}

export function portalReservationOf(v: BookingVenue, r: ReservationRow, g: GuestRow | null): PortalReservation {
  const t = tableOf(v, r.tableId);
  const seated = r.seatedTableId && r.seatedTableId !== r.tableId ? (v.byId.get(r.seatedTableId)?.code ?? null) : null;
  return {
    id: r.id,
    table: t.code,
    tableLabel: t.label,
    tier: t.tier,
    seatedTable: seated,
    partySize: r.partySize,
    slot: slotViewOf(v, r),
    status: r.status,
    guestName: g?.name ?? "Guest",
    guestEmail: g?.email ?? "",
    guestMobile: g?.mobile ?? "",
    occasion: g?.occasion ?? null,
    note: g?.note ?? null,
    priceCents: r.priceCents,
    refundCents: Math.max(r.refundCents, r.refundDueCents),
    paid: isPaid(r),
    cardBrand: r.cardBrand,
    cardLast4: r.cardLast4,
    createdAt: r.createdAt.toISOString(),
  };
}

/** "Visa ending 4242", "Apple Pay ending 4242", or null. */
export function cardWords(brand: string | null, last4: string | null): string | null {
  if (!brand || !last4) return null;
  const names: Record<string, string> = {
    visa: "Visa",
    mastercard: "Mastercard",
    amex: "American Express",
    discover: "Discover",
    apple_pay: "Apple Pay",
    google_pay: "Google Pay",
    link: "Link",
  };
  return `${names[brand] ?? brand.charAt(0).toUpperCase() + brand.slice(1)} ending ${last4}`;
}
