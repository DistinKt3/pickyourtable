"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { useRef } from "react";
import { addDays, formatDate } from "@/lib/format";

/** Previous day, the date (opens the native date picker) and next day, plus a way back to today. */
export function DateSwitcher({ date, today, onChange }: { date: string; today: string; onChange: (d: string) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const label = date === today ? `Today, ${formatDate(date, { weekday: "short" }).replace(/^\w+, /, "")}` : formatDate(date);
  const btn =
    "inline-flex size-11 items-center justify-center rounded-full text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink";
  return (
    <div className="flex items-center gap-2">
      <div className="flex items-center rounded-full bg-surface-1 p-0.5 hairline">
        <button type="button" className={btn} aria-label="Previous day" onClick={() => onChange(addDays(date, -1))}>
          <ChevronLeft aria-hidden className="size-5" strokeWidth={1.75} />
        </button>
        <span className="relative">
          <button
            type="button"
            className="min-h-11 min-w-[8.5rem] rounded-full px-3 text-base font-medium text-ink tabular transition-colors hover:bg-surface-2"
            onClick={() => input.current?.showPicker?.()}
            aria-label={`Date: ${formatDate(date, { weekday: "long" })}. Choose another date`}
          >
            {label}
          </button>
          <input
            ref={input}
            type="date"
            tabIndex={-1}
            aria-hidden
            value={date}
            onChange={(e) => e.target.value && onChange(e.target.value)}
            className="pointer-events-none absolute inset-0 opacity-0"
          />
        </span>
        <button type="button" className={btn} aria-label="Next day" onClick={() => onChange(addDays(date, 1))}>
          <ChevronRight aria-hidden className="size-5" strokeWidth={1.75} />
        </button>
      </div>
      {date !== today ? (
        <button
          type="button"
          onClick={() => onChange(today)}
          className="min-h-11 rounded-full px-4 text-[0.9375rem] font-medium text-accent transition-colors hover:bg-accent-soft"
        >
          Back to today
        </button>
      ) : null}
    </div>
  );
}
