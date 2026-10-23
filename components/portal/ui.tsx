import { Lock } from "lucide-react";
import Link from "next/link";
import type { HTMLAttributes, ReactNode } from "react";
import { cx } from "@/lib/format";

/** Small building blocks shared by every portal screen. */

export function PageHeader({
  title,
  eyebrow,
  description,
  actions,
  className,
}: {
  title: ReactNode;
  eyebrow?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <header
      className={cx("flex flex-wrap items-end justify-between gap-x-6 gap-y-4 px-4 pt-6 pb-5 sm:px-6 lg:px-8 lg:pt-8", className)}
    >
      <div className="min-w-0">
        {eyebrow ? <p className="text-[0.9375rem] text-ink-3 tabular">{eyebrow}</p> : null}
        <h1 className="font-display text-display-l text-ink">{title}</h1>
        {description ? <p className="mt-2 max-w-2xl text-base text-ink-2">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}

export function Panel({ className, ...rest }: HTMLAttributes<HTMLElement>) {
  return <section className={cx("rounded-card bg-surface-1 hairline", className)} {...rest} />;
}

export function EmptyState({
  icon,
  title,
  children,
  action,
}: {
  icon: ReactNode;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center px-6 py-14 text-center">
      <span aria-hidden className="mb-4 inline-flex size-12 items-center justify-center rounded-full bg-surface-2 text-ink-3">
        {icon}
      </span>
      <p className="text-lg font-semibold text-ink">{title}</p>
      {children ? <div className="mt-1.5 max-w-sm text-base text-ink-2">{children}</div> : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}

/** Shown when a Host opens an Owner-only address directly. */
export function OwnerOnly({ section }: { section: string }) {
  return (
    <div className="px-4 py-10 sm:px-6 lg:px-8">
      <Panel className="mx-auto max-w-lg">
        <EmptyState icon={<Lock className="size-5" strokeWidth={1.75} />} title={`${section} is for the venue owner`}>
          Hosts can run service from Tonight and Bookings. Ask the owner if something here needs to change.
          <div className="mt-5">
            <Link
              href="/portal/tonight"
              className="inline-flex min-h-11 items-center rounded-control bg-accent px-4 font-medium text-on-accent transition-[filter] hover:brightness-[1.06]"
            >
              Go to Tonight
            </Link>
          </div>
        </EmptyState>
      </Panel>
    </div>
  );
}

/** A tier's color dot, matching the ring on the plan. */
export function TierDot({ color, className }: { color: string; className?: string }) {
  return (
    <span aria-hidden className={cx("inline-block size-2.5 shrink-0 rounded-full", className)} style={{ background: color }} />
  );
}

export function SectionTitle({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <h2 className="text-lg font-semibold text-ink">{children}</h2>
      {aside ? <div className="text-[0.9375rem] text-ink-3">{aside}</div> : null}
    </div>
  );
}

/**
 * A table's name in the display serif, with its number in the interface sans: the
 * serif's "1" reads like an "l" at arm's length ("Table 11"), and a host must never
 * misread a table.
 */
export function TableName({ label, className }: { label: string; className?: string }) {
  const m = /^(.*\S)\s+(\d+)$/.exec(label);
  if (!m) return <span className={cx("font-display", className)}>{label}</span>;
  return (
    <span className={cx("font-display", className)}>
      {m[1]} <span className="font-sans text-[0.82em] font-medium tracking-normal tabular">{m[2]}</span>
    </span>
  );
}
