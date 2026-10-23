"use client";

import { create } from "zustand";
import type {
  AlternativeTime,
  CheckoutResponse,
  GuestDetails,
  HoldStatusResponse,
  HoldView,
  SlotView,
} from "@/lib/api/contracts";

/**
 * The booking flow, separate from the room store: which step the guest is on, the
 * hold and its token, checkout and the confirmed booking. The hold survives a reload
 * or a dropped connection through sessionStorage.
 */

export type Step = "room" | "details" | "pay" | "confirmed" | "expired";

export interface Notice {
  tone: "neutral" | "danger" | "warning" | "success";
  title: string;
  body?: string;
  /** The table and slot it is about; it stops showing once the guest moves on. */
  table?: string;
  slotKey?: string;
}

export function slotKey(s: { date: string; time: string; party: number } | null): string {
  return s ? `${s.date}|${s.time}|${s.party}` : "";
}

interface BookingState {
  step: Step;
  hold: HoldView | null;
  holdToken: string | null;
  guest: GuestDetails | null;
  payment: CheckoutResponse["payment"] | null;
  booking: NonNullable<HoldStatusResponse["booking"]> | null;
  /** The slot as the server resolved it, from the last availability answer. */
  slotView: SlotView | null;
  alternatives: Record<string, AlternativeTime[]>;
  notice: Notice | null;
  paymentError: string | null;

  startHold: (hold: HoldView, token: string) => void;
  setGuest: (g: GuestDetails) => void;
  setPayment: (p: CheckoutResponse["payment"]) => void;
  setStep: (s: Step) => void;
  confirm: (status: HoldStatusResponse) => void;
  expire: () => void;
  setSlotInfo: (slot: SlotView | null, alternatives: Record<string, AlternativeTime[]>) => void;
  setNotice: (n: Notice | null) => void;
  setPaymentError: (m: string | null) => void;
  reset: () => void;
}

const KEY = "pyt.hold";

export interface SavedHold {
  venueId: string;
  holdId: string;
  token: string;
}

export function saveHold(h: SavedHold | null): void {
  try {
    if (h) sessionStorage.setItem(KEY, JSON.stringify(h));
    else sessionStorage.removeItem(KEY);
  } catch {
    /* storage unavailable: the hold still works for this page view */
  }
}

export function loadSavedHold(venueId: string): SavedHold | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    const h = JSON.parse(raw) as SavedHold;
    return h.venueId === venueId && typeof h.holdId === "string" && typeof h.token === "string" ? h : null;
  } catch {
    return null;
  }
}

const initial = {
  step: "room" as Step,
  hold: null,
  holdToken: null,
  guest: null,
  payment: null,
  booking: null,
  notice: null,
  paymentError: null,
};

export const useBooking = create<BookingState>()((set) => ({
  ...initial,
  slotView: null,
  alternatives: {},
  startHold: (hold, holdToken) => {
    saveHold({ venueId: hold.venueId, holdId: hold.id, token: holdToken });
    set({ hold, holdToken, step: "details", payment: null, paymentError: null, notice: null, booking: null });
  },
  setGuest: (guest) => set({ guest }),
  setPayment: (payment) => set({ payment, step: "pay", paymentError: null }),
  setStep: (step) => set({ step }),
  confirm: (status) => {
    saveHold(null);
    set({ hold: status.hold, booking: status.booking, step: "confirmed", paymentError: null });
  },
  expire: () => {
    saveHold(null);
    set({ step: "expired", payment: null });
  },
  setSlotInfo: (slotView, alternatives) => set({ slotView, alternatives }),
  setNotice: (notice) => set({ notice }),
  setPaymentError: (paymentError) => set({ paymentError }),
  reset: () => {
    saveHold(null);
    set({ ...initial });
  },
}));
