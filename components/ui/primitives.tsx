"use client";

import { type ReactNode, useEffect, useId, useRef } from "react";
import { cx } from "@/lib/format";

type Tone = "neutral" | "accent" | "success" | "danger" | "warning";

const tones: Record<Tone, string> = {
  neutral: "bg-surface-2 text-ink-2",
  accent: "bg-accent-soft text-accent",
  success: "bg-success-surface text-success",
  danger: "bg-danger-surface text-danger",
  warning: "bg-warning-surface text-warning",
};

/** Small uppercase status label, such as PAID. */
export function Badge({ tone = "neutral", children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return (
    <span
      className={cx(
        "inline-flex h-6 items-center rounded-full px-2.5 text-[0.75rem] font-semibold tracking-[0.06em] uppercase tabular",
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

/** Attribute chip on the table card. */
export function Chip({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span className={cx("inline-flex h-8 items-center rounded-full bg-surface-2 px-3 text-[0.9375rem] text-ink-2", className)}>
      {children}
    </span>
  );
}

export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
  className,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  className?: string;
}) {
  const name = useId();
  return (
    <fieldset className={cx("inline-flex rounded-full bg-surface-2 p-1", className)}>
      <legend className="sr-only">{label}</legend>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <label key={o.value} className="relative">
            <input
              type="radio"
              name={name}
              value={o.value}
              checked={active}
              onChange={() => onChange(o.value)}
              // The pill is 36 px; the hit area spans the control's full 44 px.
              className="peer absolute inset-x-0 -inset-y-1 cursor-pointer opacity-0"
            />
            <span
              className={cx(
                "flex min-h-9 items-center rounded-full px-4 text-[0.9375rem] font-medium transition-[background-color,color,box-shadow] duration-200 ease-out-soft peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent",
                active ? "bg-surface-1 text-ink shadow-chip" : "text-ink-2 hover:text-ink",
              )}
            >
              {o.label}
            </span>
          </label>
        );
      })}
    </fieldset>
  );
}

export function Switch({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cx(
        "relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors duration-200 ease-out-soft disabled:opacity-50",
        checked ? "bg-accent" : "bg-surface-3",
      )}
    >
      <span
        aria-hidden
        className={cx(
          "inline-block size-6 rounded-full bg-white shadow-[0_1px_3px_rgb(0_0_0/0.25)] transition-transform duration-200 ease-out-soft",
          checked ? "translate-x-[1.375rem]" : "translate-x-0.5",
        )}
      />
    </button>
  );
}

export function Stepper({
  label,
  value,
  min,
  max,
  onChange,
  format = String,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
  format?: (v: number) => string;
}) {
  const btn =
    "inline-flex size-11 items-center justify-center rounded-full bg-surface-1 text-ink hairline transition-colors duration-150 hover:bg-surface-2 disabled:text-ink-3 disabled:hover:bg-surface-1";
  return (
    <fieldset className="flex items-center gap-4">
      <legend className="sr-only">{label}</legend>
      <button
        type="button"
        className={btn}
        aria-label={`Fewer: ${label}`}
        disabled={value <= min}
        onClick={() => onChange(value - 1)}
      >
        <svg viewBox="0 0 16 16" className="size-4" aria-hidden>
          <path d="M3.5 8h9" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      </button>
      <output aria-live="polite" className="min-w-20 text-center text-lg font-medium tabular">
        {format(value)}
      </output>
      <button
        type="button"
        className={btn}
        aria-label={`More: ${label}`}
        disabled={value >= max}
        onClick={() => onChange(value + 1)}
      >
        <svg viewBox="0 0 16 16" className="size-4" aria-hidden>
          <path d="M3.5 8h9M8 3.5v9" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      </button>
    </fieldset>
  );
}

/** Inline message. `role` is alert for errors, status otherwise. */
export function Banner({
  tone = "neutral",
  title,
  children,
  action,
  className,
}: {
  tone?: Tone;
  title?: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      role={tone === "danger" ? "alert" : "status"}
      className={cx("flex items-start gap-3 rounded-card px-4 py-3", tones[tone], className)}
    >
      <div className="min-w-0 flex-1">
        {title ? <p className="font-semibold text-base text-current">{title}</p> : null}
        {children ? <div className={cx("text-base", title ? "mt-0.5 opacity-90" : "")}>{children}</div> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

/**
 * Modal dialog on the native <dialog> element: focus is trapped, Escape closes it and
 * the page behind is inert, without extra code.
 */
export function Dialog({
  open,
  onClose,
  title,
  children,
  footer,
  className,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      aria-labelledby="dialog-title"
      className={cx(
        "m-auto w-[min(32rem,calc(100vw-2rem))] rounded-sheet bg-surface-1 p-0 text-ink shadow-pop backdrop:bg-[var(--scrim)] open:animate-[dialog-in_200ms_var(--ease-out-soft)]",
        className,
      )}
    >
      <div className="px-6 pt-6 pb-2">
        <h2 id="dialog-title" className="font-display text-display-m">
          {title}
        </h2>
      </div>
      <div className="px-6 pb-4 text-ink-2">{children}</div>
      {footer ? <div className="flex flex-col-reverse gap-2 px-6 pb-6 sm:flex-row sm:justify-end">{footer}</div> : null}
    </dialog>
  );
}

export function VisuallyHidden({ children }: { children: ReactNode }) {
  return <span className="sr-only">{children}</span>;
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="rounded-md bg-surface-2 px-1.5 py-0.5 font-sans text-sm text-ink-2 hairline">{children}</kbd>;
}
