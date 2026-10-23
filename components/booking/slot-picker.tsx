"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Banner, Stepper } from "@/components/ui/primitives";
import type { SlotsResponse } from "@/lib/api/contracts";
import { addDays, cx, dayOfMonth, formatDate, formatTime, isoWeekday, partyLabel, weekdayShort } from "@/lib/format";
import type { Slot } from "@/lib/room/store";
import type { Venue } from "@/lib/venue/schema";
import { ApiFailure, api } from "./api";

/**
 * Date, time and party in one sheet (PRD guest step 3). The times come from the
 * server for that date and party, with how many tables are free at each.
 */
export function SlotPicker({
  venue,
  today,
  initial,
  party: initialParty,
  largestParty,
  onApply,
  onCancel,
}: {
  venue: Venue;
  today: string;
  initial: Slot | null;
  party: number;
  /** The most guests any bookable table seats. */
  largestParty: number;
  onApply: (slot: Slot) => void;
  onCancel: () => void;
}) {
  const days = useMemo(() => {
    const open = new Set(venue.booking.dayparts.flatMap((d) => d.days));
    return Array.from({ length: venue.booking.bookingWindowDays }, (_, i) => addDays(today, i)).map((date) => ({
      date,
      open: open.has(isoWeekday(date)),
    }));
  }, [venue, today]);

  const [date, setDate] = useState(initial?.date ?? today);
  const [time, setTime] = useState<string | null>(initial?.time ?? null);
  const [party, setParty] = useState(initial?.party ?? initialParty);
  const [result, setResult] = useState<{ key: string; slots: SlotsResponse | null; error: string | null } | null>(null);
  const stripRef = useRef<HTMLDivElement>(null);
  const key = `${date}|${party}`;

  useEffect(() => {
    const ctrl = new AbortController();
    const load = async () => {
      try {
        const s = await api.slots(venue.id, date, party, ctrl.signal);
        setResult({ key, slots: s, error: null });
      } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") return;
        setResult({ key, slots: null, error: e instanceof ApiFailure ? e.message : "Could not load times." });
      }
    };
    void load();
    return () => ctrl.abort();
  }, [venue.id, date, party, key]);

  const current = result?.key === key ? result : null;
  const slots = current?.slots ?? null;
  const error = current?.error ?? null;

  // Keep the chosen day visible in the strip.
  useEffect(() => {
    stripRef.current?.querySelector<HTMLElement>(`[data-date="${date}"]`)?.scrollIntoView({ block: "nearest", inline: "center" });
  }, [date]);

  const times = slots?.dayparts.flatMap((d) => d.times) ?? [];
  const chosen = times.find((t) => t.time === time);
  const valid = Boolean(chosen && chosen.freeTables > 0);
  const anyTimes = times.length > 0;
  const maxParty = venue.booking.maxParty;
  const largest = largestParty;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex-1 overflow-y-auto px-5 pb-4">
        <h2 className="font-display text-display-m">When are you coming?</h2>

        <section aria-labelledby="party-label" className="mt-5 flex items-center justify-between gap-4">
          <h3 id="party-label" className="text-base font-medium">
            Party size
          </h3>
          <Stepper label="Party size" value={party} min={1} max={maxParty} onChange={setParty} format={partyLabel} />
        </section>
        {party > largest ? (
          <Banner tone="warning" className="mt-3">
            Our bookable tables seat up to {largest}. For {party} guests, call {venue.name} at {venue.contact.phone}.
          </Banner>
        ) : null}

        <section aria-labelledby="date-label" className="mt-6">
          <h3 id="date-label" className="text-base font-medium">
            Date
          </h3>
          <div ref={stripRef} className="-mx-5 mt-2.5 flex gap-2 overflow-x-auto px-5 pb-1 scrollbar-none" data-vaul-no-drag>
            {days.map((d) => {
              const active = d.date === date;
              return (
                <button
                  key={d.date}
                  type="button"
                  data-date={d.date}
                  disabled={!d.open}
                  aria-pressed={active}
                  aria-label={formatDate(d.date, { weekday: "long" })}
                  onClick={() => {
                    setDate(d.date);
                    setTime(null);
                  }}
                  className={cx(
                    "flex h-[4.25rem] w-14 shrink-0 flex-col items-center justify-center rounded-card tabular transition-colors duration-150",
                    active ? "bg-ink text-surface-1" : "bg-surface-1 text-ink hairline hover:bg-surface-2",
                    !d.open && "opacity-40",
                  )}
                >
                  <span className={cx("text-[0.8125rem]", active ? "opacity-80" : "text-ink-3")}>
                    {d.date === today ? "Today" : weekdayShort(d.date)}
                  </span>
                  <span className="text-lg leading-tight font-semibold">{dayOfMonth(d.date)}</span>
                </button>
              );
            })}
          </div>
        </section>

        <section aria-labelledby="time-label" className="mt-6">
          <h3 id="time-label" className="text-base font-medium">
            Time <span className="font-normal text-ink-3">· {formatDate(date, { weekday: "long" })}</span>
          </h3>
          {error ? (
            <Banner tone="danger" className="mt-3">
              {error}
            </Banner>
          ) : !slots ? (
            <div className="mt-3 grid grid-cols-4 gap-2" aria-busy>
              {Array.from({ length: 12 }, (_, i) => (
                <div key={i} className="h-11 animate-pulse rounded-control bg-surface-2" />
              ))}
            </div>
          ) : !anyTimes ? (
            <p className="mt-3 text-ink-2">No times left on this day. Try the next day.</p>
          ) : (
            slots.dayparts
              .filter((d) => d.times.length)
              .map((d) => (
                <div key={d.id} className="mt-3">
                  <p className="mb-2 text-sm font-medium tracking-[0.06em] text-ink-3 uppercase">{d.name}</p>
                  <div className="grid grid-cols-4 gap-2">
                    {d.times.map((t) => {
                      const full = t.freeTables === 0;
                      const active = t.time === time;
                      return (
                        <button
                          key={t.time}
                          type="button"
                          disabled={full}
                          aria-pressed={active}
                          aria-label={`${formatTime(t.time)}${full ? ", fully booked" : `, ${t.freeTables} tables free`}`}
                          onClick={() => setTime(t.time)}
                          className={cx(
                            "h-11 rounded-control text-[0.9375rem] font-medium tabular transition-colors duration-150",
                            active
                              ? "bg-ink text-surface-1"
                              : full
                                ? "bg-surface-2 text-ink-3 line-through decoration-ink-3/50"
                                : "bg-surface-1 text-ink hairline hover:bg-surface-2",
                          )}
                        >
                          {formatTime(t.time).replace(" ", " ")}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))
          )}
        </section>
      </div>
      <div className="flex shrink-0 gap-2 border-t border-line bg-surface-1 px-5 pt-3 pb-4">
        <Button variant="secondary" size="lg" onClick={onCancel}>
          Cancel
        </Button>
        <Button size="lg" block disabled={!valid} onClick={() => time && onApply({ date, time, party })}>
          {chosen ? `Show tables for ${formatTime(chosen.time)}` : "Choose a time"}
        </Button>
      </div>
    </div>
  );
}
