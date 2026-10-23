import { LogOut } from "lucide-react";
import type { ReactNode } from "react";
import { BarNav, RailNav } from "./nav";

/**
 * The portal frame: a persistent rail with the venue's name, the sections the
 * operator's role can use, who is signed in and sign out. On a phone the rail
 * becomes a top bar with a row of tabs. Hidden when printing.
 */

export interface ShellProps {
  venueName: string;
  demo: boolean;
  operatorName: string;
  roleLabel: string;
  isOwner: boolean;
  accent: Record<string, string>;
  children: ReactNode;
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("");
}

function SignOut({ compact }: { compact?: boolean }) {
  return (
    <form method="post" action="/api/portal/auth/sign-out">
      <button
        type="submit"
        aria-label={compact ? "Sign out" : undefined}
        className={
          compact
            ? "inline-flex size-11 items-center justify-center rounded-full text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink"
            : "flex min-h-11 w-full items-center gap-3 rounded-control px-3 text-[0.9375rem] font-medium text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink"
        }
      >
        <LogOut aria-hidden className="size-5 text-ink-3" strokeWidth={1.75} />
        {compact ? null : "Sign out"}
      </button>
    </form>
  );
}

export function PortalShell({ venueName, demo, operatorName, roleLabel, isOwner, accent, children }: ShellProps) {
  return (
    <div
      style={accent}
      className="min-h-dvh bg-surface-0 text-ink md:grid md:grid-cols-[14rem_minmax(0,1fr)] xl:grid-cols-[15.5rem_minmax(0,1fr)]"
    >
      <a
        href="#main"
        className="sr-only z-50 rounded-control bg-surface-1 px-4 py-3 font-medium shadow-pop focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
      >
        Skip to content
      </a>

      <aside className="sticky top-0 hidden h-dvh flex-col border-r border-line bg-surface-1 px-3 pt-7 pb-4 md:flex print:hidden">
        <div className="px-3 pb-8">
          <p className="font-display text-[1.875rem] leading-[1.05] text-ink">{venueName}</p>
          <p className="mt-2 flex items-center gap-2 text-sm text-ink-3">
            Venue portal
            {demo ? (
              <span className="inline-flex h-5 items-center rounded-full bg-surface-2 px-2 text-[0.75rem] font-medium text-ink-2">
                Demo venue
              </span>
            ) : null}
          </p>
        </div>
        <RailNav isOwner={isOwner} />
        <div className="mt-auto flex flex-col gap-1 border-t border-line pt-4">
          <div className="flex items-center gap-3 px-3 pb-2">
            <span
              aria-hidden
              className="inline-flex size-10 shrink-0 items-center justify-center rounded-full bg-accent-soft text-[0.9375rem] font-semibold text-accent"
            >
              {initials(operatorName)}
            </span>
            <span className="min-w-0">
              <span className="block truncate text-[0.9375rem] font-medium text-ink">{operatorName}</span>
              <span className="block text-sm text-ink-3">{roleLabel}</span>
            </span>
          </div>
          <SignOut />
        </div>
      </aside>

      <header className="sticky top-0 z-20 border-b border-line bg-surface-1/95 px-4 pt-3 pb-2 backdrop-blur md:hidden print:hidden">
        <div className="flex items-center justify-between gap-3 pb-2">
          <div className="min-w-0">
            <p className="truncate font-display text-[1.625rem] leading-tight">{venueName}</p>
            <p className="truncate text-sm text-ink-3">
              {operatorName} · {roleLabel}
            </p>
          </div>
          <SignOut compact />
        </div>
        <BarNav isOwner={isOwner} />
      </header>

      <main id="main" tabIndex={-1} className="min-w-0 outline-none">
        {children}
      </main>
    </div>
  );
}
