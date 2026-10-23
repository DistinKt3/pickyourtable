"use client";

import { Armchair, BookOpenText, CalendarOff, ClipboardCheck, ConciergeBell, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cx } from "@/lib/format";

/** The portal's sections. Owner-only sections are not shown to Hosts at all. */

interface Item {
  href: string;
  label: string;
  icon: LucideIcon;
  owner: boolean;
}

export const SECTIONS: { group: string; items: Item[] }[] = [
  {
    group: "Service",
    items: [
      { href: "/portal/tonight", label: "Tonight", icon: ConciergeBell, owner: false },
      { href: "/portal/bookings", label: "Bookings", icon: BookOpenText, owner: false },
    ],
  },
  {
    group: "Setup",
    items: [
      { href: "/portal/tables", label: "Tables and pricing", icon: Armchair, owner: true },
      { href: "/portal/blackouts", label: "Blackouts", icon: CalendarOff, owner: true },
      { href: "/portal/review", label: "Venue review", icon: ClipboardCheck, owner: true },
    ],
  },
];

function visible(isOwner: boolean) {
  return SECTIONS.flatMap((s) => {
    const items = s.items.filter((i) => isOwner || !i.owner);
    return items.length ? [{ group: s.group, items }] : [];
  });
}

export function RailNav({ isOwner }: { isOwner: boolean }) {
  const path = usePathname();
  return (
    <nav aria-label="Portal" className="flex flex-col gap-6">
      {visible(isOwner).map((section) => (
        <div key={section.group} className="flex flex-col gap-1">
          <p className="px-3 pb-1 text-[0.8125rem] font-medium tracking-[0.08em] text-ink-3 uppercase">{section.group}</p>
          {section.items.map((item) => {
            const active = path === item.href || path.startsWith(`${item.href}/`);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cx(
                  "group relative flex min-h-12 items-center gap-3 rounded-control px-3 text-base font-medium transition-colors duration-150",
                  active ? "bg-surface-2 text-ink" : "text-ink-2 hover:bg-surface-2/70 hover:text-ink",
                )}
              >
                <span
                  aria-hidden
                  className={cx(
                    "absolute top-3 bottom-3 left-0 w-[3px] rounded-full bg-accent transition-opacity duration-150",
                    active ? "opacity-100" : "opacity-0",
                  )}
                />
                <Icon
                  aria-hidden
                  className={cx("size-5 shrink-0", active ? "text-accent" : "text-ink-3 group-hover:text-ink-2")}
                  strokeWidth={1.75}
                />
                <span className="leading-tight">{item.label}</span>
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}

/** Phone: the same sections as a scrolling row of tabs under the top bar. */
export function BarNav({ isOwner }: { isOwner: boolean }) {
  const path = usePathname();
  return (
    <nav aria-label="Portal" className="scrollbar-none -mx-4 flex gap-1 overflow-x-auto px-4">
      {visible(isOwner)
        .flatMap((s) => s.items)
        .map((item) => {
          const active = path === item.href || path.startsWith(`${item.href}/`);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={cx(
                "flex min-h-11 shrink-0 items-center gap-2 rounded-full px-3.5 text-[0.9375rem] font-medium whitespace-nowrap transition-colors",
                active ? "bg-ink text-surface-1" : "text-ink-2 hover:bg-surface-2",
              )}
            >
              <Icon aria-hidden className="size-4" strokeWidth={1.75} />
              {item.label}
            </Link>
          );
        })}
    </nav>
  );
}
