"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { useRoom } from "@/lib/room/store";
import { ApiFailure, api } from "./api";
import { useBooking } from "./booking-store";

/** Matches a media query; false during server render. */
export function useMedia(query: string): boolean {
  return useSyncExternalStore(
    (cb) => {
      const m = window.matchMedia(query);
      m.addEventListener("change", cb);
      return () => m.removeEventListener("change", cb);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}

export const useIsDesktop = () => useMedia("(min-width: 1024px)");
export const useReducedMotion = () => useMedia("(prefers-reduced-motion: reduce)");

export function useOnline(): boolean {
  return useSyncExternalStore(
    (cb) => {
      window.addEventListener("online", cb);
      window.addEventListener("offline", cb);
      return () => {
        window.removeEventListener("online", cb);
        window.removeEventListener("offline", cb);
      };
    },
    () => navigator.onLine,
    () => true,
  );
}

const POLL_MS = 5000;

/**
 * Live availability for the chosen slot (PRD G-2). Refreshes every 5 seconds while
 * the page is visible, so a table taken or blacked out elsewhere dims here within
 * seconds (PRD O-4: 10 s). The status is derived from which slot the last answer
 * was for, so nothing is set synchronously when the slot changes.
 */
export function useAvailability(venueId: string): { status: "idle" | "loading" | "ready" | "error"; error: string | null } {
  const slot = useRoom((s) => s.slot);
  const setAvailability = useRoom((s) => s.setAvailability);
  const setSlotInfo = useBooking((s) => s.setSlotInfo);
  const [result, setResult] = useState<{ key: string; ok: boolean; error: string | null } | null>(null);
  const key = slot ? `${slot.date}|${slot.time}|${slot.party}` : null;

  useEffect(() => {
    if (!slot || !key) {
      setAvailability(null);
      setSlotInfo(null, {});
      return;
    }
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let ctrl: AbortController | null = null;
    const schedule = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (document.visibilityState === "visible") void load();
        else schedule();
      }, POLL_MS);
    };
    const load = async () => {
      ctrl?.abort();
      ctrl = new AbortController();
      try {
        const res = await api.availability(venueId, slot.date, slot.time, slot.party, ctrl.signal);
        if (!alive) return;
        setAvailability(res.tables);
        setSlotInfo(res.slot, res.alternatives);
        setResult({ key, ok: true, error: null });
      } catch (e) {
        if (!alive || (e instanceof DOMException && e.name === "AbortError")) return;
        setResult({ key, ok: false, error: e instanceof ApiFailure ? e.message : "Could not load tables." });
      } finally {
        if (alive) schedule();
      }
    };
    void load();
    const onVisible = () => {
      if (document.visibilityState === "visible") void load();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      alive = false;
      ctrl?.abort();
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [venueId, slot, key, setAvailability, setSlotInfo]);

  if (!key) return { status: "idle", error: null };
  if (!result || result.key !== key) return { status: "loading", error: null };
  return { status: result.ok ? "ready" : "error", error: result.error };
}

/** A ticking clock for countdowns; ticks every `ms` while mounted. */
export function useNow(ms = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}
