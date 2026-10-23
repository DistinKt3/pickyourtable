"use client";

import { cx } from "@/lib/format";

/** A dollar input: "$" prefix, tabular digits, 44 px tall, a clear changed and invalid state. */
export function MoneyInput({
  label,
  value,
  onChange,
  changed,
  invalid,
  className,
  describedBy,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  changed?: boolean;
  invalid?: boolean;
  className?: string;
  describedBy?: string;
}) {
  return (
    <label className={cx("relative block", className)}>
      <span className="sr-only">{label}</span>
      <span aria-hidden className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-base text-ink-3">
        $
      </span>
      <input
        type="text"
        inputMode="decimal"
        autoComplete="off"
        value={value}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        onChange={(e) => onChange(e.target.value)}
        className={cx(
          "block h-11 w-full rounded-control pr-3 pl-7 text-right text-base font-medium text-ink tabular transition-shadow duration-150 focus:outline-none",
          invalid
            ? "bg-danger-surface shadow-[inset_0_0_0_1.5px_var(--danger)]"
            : changed
              ? "bg-accent-soft shadow-[inset_0_0_0_1.5px_var(--accent-base)]"
              : "bg-surface-1 hairline focus:shadow-[inset_0_0_0_2px_var(--accent-base)]",
        )}
      />
    </label>
  );
}
