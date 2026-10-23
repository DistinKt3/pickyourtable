import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cx } from "@/lib/format";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md" | "lg";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  block?: boolean;
  loading?: boolean;
  icon?: ReactNode;
  ref?: React.Ref<HTMLButtonElement>;
}

const base =
  "relative inline-flex select-none items-center justify-center gap-2 whitespace-nowrap rounded-control font-medium tabular transition-[background-color,box-shadow,transform,opacity] duration-150 ease-out-soft active:scale-[0.985] disabled:active:scale-100";

const variants: Record<Variant, string> = {
  primary:
    "bg-accent text-on-accent shadow-[0_1px_0_rgb(255_255_255/0.12)_inset,0_1px_2px_rgb(0_0_0/0.12)] hover:brightness-[1.06] disabled:opacity-45",
  secondary: "bg-surface-1 text-ink hairline hover:bg-surface-2 disabled:text-ink-3",
  ghost: "text-ink-2 hover:bg-surface-2 hover:text-ink disabled:text-ink-3",
  danger: "bg-danger text-surface-1 hover:brightness-[1.06] disabled:opacity-45",
};

const sizes: Record<Size, string> = {
  sm: "min-h-9 px-3 text-[0.9375rem]",
  md: "min-h-11 px-4 text-base",
  lg: "min-h-[3.25rem] px-5 text-[1.0625rem]",
};

export function Button({
  variant = "primary",
  size = "md",
  block,
  loading,
  icon,
  className,
  children,
  disabled,
  ...rest
}: ButtonProps) {
  return (
    <button
      type="button"
      {...rest}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cx(base, variants[variant], sizes[size], block && "w-full", className)}
    >
      {loading ? <Dots /> : icon}
      <span className={cx(loading && "opacity-0")}>{children}</span>
      {loading ? <span className="sr-only">Working</span> : null}
    </button>
  );
}

function Dots() {
  return (
    <span aria-hidden className="absolute inset-0 flex items-center justify-center gap-1">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="size-1.5 animate-pulse rounded-full bg-current"
          style={{ animationDelay: `${i * 140}ms`, animationDuration: "900ms" }}
        />
      ))}
    </span>
  );
}

export function IconButton({
  label,
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; ref?: React.Ref<HTMLButtonElement> }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      {...rest}
      className={cx(
        "inline-flex size-11 shrink-0 items-center justify-center rounded-full text-ink-2 transition-colors duration-150 hover:bg-surface-2 hover:text-ink disabled:text-ink-3",
        className,
      )}
    >
      {children}
    </button>
  );
}
