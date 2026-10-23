import type { ReactNode } from "react";

/** The centered card used by sign-in and the link page, before anyone is signed in. */
export function AuthCard({
  eyebrow,
  title,
  children,
  accent,
}: {
  eyebrow: ReactNode;
  title: string;
  children: ReactNode;
  /** The venue's accent, once the link says which venue this is. */
  accent?: Record<string, string>;
}) {
  return (
    <main style={accent} className="flex min-h-dvh items-center justify-center bg-surface-0 px-4 py-12">
      <div className="w-full max-w-[26rem]">
        <div className="rounded-sheet bg-surface-1 px-6 pt-8 pb-7 shadow-pop hairline sm:px-8">
          <p className="text-sm font-medium tracking-[0.08em] text-ink-3 uppercase">{eyebrow}</p>
          <h1 className="mt-2 font-display text-display-l text-ink">{title}</h1>
          <div className="mt-4">{children}</div>
        </div>
        <p className="mt-6 text-center text-sm text-balance text-ink-3">
          For venue owners and hosts. Guests book from the venue&rsquo;s own link.
        </p>
      </div>
    </main>
  );
}
