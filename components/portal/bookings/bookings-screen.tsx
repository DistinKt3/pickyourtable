"use client";

import { BookOpenText, Search, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Banner, Segmented } from "@/components/ui/primitives";
import type { BookingsResponse, PortalReservation } from "@/lib/api/contracts";
import { addDays, cx, formatDate, formatMoney, formatTime } from "@/lib/format";
import { PortalError, portalFetch } from "@/lib/portal/client";
import { EmptyState, PageHeader, Panel, TableName } from "../ui";
import { BookingDetail } from "./booking-detail";
import { cardText, StatusDot } from "./format";

/**
 * Bookings (PRD O-2): search by name, email or table; filter by Upcoming, Past,
 * Cancelled or All; open a booking for contact details, history and actions.
 */

type Filter = "upcoming" | "past" | "cancelled" | "all";

const FILTERS: { value: Filter; label: string }[] = [
  { value: "upcoming", label: "Upcoming" },
  { value: "past", label: "Past" },
  { value: "cancelled", label: "Cancelled" },
  { value: "all", label: "All" },
];

export function BookingsScreen({
  initial,
  initialError,
  initialQuery,
  isOwner,
  today,
  timezone,
  labels,
}: {
  initial: BookingsResponse | null;
  initialError: string | null;
  initialQuery: string;
  isOwner: boolean;
  today: string;
  timezone: string;
  labels: Record<string, string>;
}) {
  const [q, setQ] = useState(initialQuery);
  const [status, setStatus] = useState<Filter>("upcoming");
  const [bookings, setBookings] = useState<PortalReservation[] | null>(initial && !initialQuery ? initial.bookings : null);
  const [error, setError] = useState<string | null>(initialError);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState<PortalReservation | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const first = useRef(Boolean(initial) && !initialQuery);

  const load = useCallback(async (query: string, filter: Filter, signal?: AbortSignal) => {
    setLoading(true);
    const params = new URLSearchParams({ status: filter });
    if (query.trim()) params.set("q", query.trim());
    try {
      const r = await portalFetch<BookingsResponse>(`/api/portal/bookings?${params}`, { signal });
      setBookings(r.bookings);
      setError(null);
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return;
      setError(e instanceof PortalError ? e.message : "Bookings can't load right now.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => void load(q, status, controller.signal), q ? 250 : 0);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [q, status, load]);

  const groups = useMemo(() => {
    const out: { date: string; items: PortalReservation[] }[] = [];
    for (const b of bookings ?? []) {
      const last = out.at(-1);
      if (last && last.date === b.slot.date) last.items.push(b);
      else out.push({ date: b.slot.date, items: [b] });
    }
    return out;
  }, [bookings]);

  const dayLabel = (d: string) =>
    d === today
      ? `Today · ${formatDate(d)}`
      : d === addDays(today, 1)
        ? `Tomorrow · ${formatDate(d)}`
        : d === addDays(today, -1)
          ? `Yesterday · ${formatDate(d)}`
          : formatDate(d, { weekday: "long", year: d.slice(0, 4) !== today.slice(0, 4) });

  return (
    <div className="pb-10">
      <PageHeader title="Bookings" eyebrow="Paid table bookings" />
      <div className="flex flex-wrap items-center gap-3 px-4 pb-4 sm:px-6 lg:px-8">
        <label className="relative min-w-0 flex-1 basis-72">
          <span className="sr-only">Search bookings</span>
          <Search
            aria-hidden
            className="pointer-events-none absolute top-1/2 left-3.5 size-5 -translate-y-1/2 text-ink-3"
            strokeWidth={1.75}
          />
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search by guest, email or table"
            className="block h-12 w-full rounded-control bg-surface-1 pr-11 pl-11 text-base text-ink hairline placeholder:text-ink-3 focus:shadow-[inset_0_0_0_2px_var(--accent-base)] focus:outline-none [&::-webkit-search-cancel-button]:hidden"
          />
          {q ? (
            <button
              type="button"
              onClick={() => setQ("")}
              aria-label="Clear search"
              className="absolute top-1/2 right-1 inline-flex size-10 -translate-y-1/2 items-center justify-center rounded-full text-ink-3 hover:bg-surface-2 hover:text-ink"
            >
              <X aria-hidden className="size-4" />
            </button>
          ) : null}
        </label>
        <Segmented label="Show" value={status} options={FILTERS} onChange={setStatus} />
      </div>

      <div className="flex flex-col gap-3 px-4 sm:px-6 lg:px-8">
        {notice ? (
          <Banner tone="success" action={<CloseNotice onClose={() => setNotice(null)} />}>
            {notice}
          </Banner>
        ) : null}
        {error ? (
          <Banner tone="danger" title="Bookings can't load right now">
            {error}
          </Banner>
        ) : null}

        <Panel
          className={cx("@container overflow-clip transition-opacity duration-150", loading && bookings ? "opacity-70" : "")}
        >
          <div className="hidden border-b border-line px-5 py-2.5 text-sm font-medium text-ink-3 @3xl:grid @3xl:grid-cols-[5.5rem_minmax(0,1.7fr)_minmax(0,1fr)_3.5rem_5rem_7.5rem_9rem] @3xl:gap-x-4">
            <span>Time</span>
            <span>Guest</span>
            <span>Table</span>
            <span>Party</span>
            <span className="text-right">Fee</span>
            <span>Status</span>
            <span>Card</span>
          </div>
          {bookings === null ? (
            <Skeleton />
          ) : bookings.length === 0 ? (
            <EmptyState
              icon={<BookOpenText className="size-5" strokeWidth={1.75} />}
              title={q ? "No bookings match" : "Nothing here yet"}
            >
              {q
                ? `Nothing for "${q}" in ${FILTERS.find((f) => f.value === status)!.label.toLowerCase()} bookings. Try All.`
                : "Paid bookings show here as guests book."}
            </EmptyState>
          ) : (
            groups.map((g) => (
              <section key={g.date} aria-label={dayLabel(g.date)}>
                <h2 className="z-[1] flex items-baseline md:sticky md:top-0 justify-between border-b border-line bg-surface-0/95 px-5 py-2 text-[0.9375rem] font-semibold text-ink backdrop-blur">
                  {dayLabel(g.date)}
                  <span className="font-normal text-ink-3 tabular">
                    {g.items.length} {g.items.length === 1 ? "booking" : "bookings"}
                  </span>
                </h2>
                <ul className="divide-y divide-line">
                  {g.items.map((b) => (
                    <li key={b.id}>
                      <Row b={b} onOpen={() => setOpen(b)} />
                    </li>
                  ))}
                </ul>
              </section>
            ))
          )}
        </Panel>
      </div>

      {open ? (
        <BookingDetail
          booking={open}
          isOwner={isOwner}
          timezone={timezone}
          labels={labels}
          canCancel={open.status === "confirmed" && open.slot.date >= today}
          onClose={() => setOpen(null)}
          onChanged={(next, message) => {
            setOpen(null);
            setNotice(message);
            setBookings((list) => list?.map((x) => (x.id === next.id ? next : x)) ?? list);
            void load(q, status);
          }}
        />
      ) : null}
    </div>
  );
}

function Row({ b, onOpen }: { b: PortalReservation; onOpen: () => void }) {
  const cancelled = b.status === "cancelled";
  return (
    <button
      type="button"
      onClick={onOpen}
      className="grid w-full grid-cols-[4.25rem_minmax(0,1fr)_auto] items-center gap-x-4 px-5 py-3.5 text-left transition-colors hover:bg-surface-2/60 focus-visible:bg-surface-2/60 @3xl:grid-cols-[5.5rem_minmax(0,1.7fr)_minmax(0,1fr)_3.5rem_5rem_7.5rem_9rem]"
    >
      <span className={cx("text-[1.0625rem] font-semibold text-ink tabular", cancelled && "text-ink-3")}>
        {formatTime(b.slot.time)}
      </span>
      <span className="min-w-0">
        <span
          className={cx(
            "block truncate text-[1.0625rem] font-medium",
            cancelled ? "text-ink-3 line-through decoration-1" : "text-ink",
          )}
        >
          {b.guestName}
        </span>
        <span className="block truncate text-[0.9375rem] text-ink-3 @3xl:hidden">
          {b.tableLabel} · {b.partySize} {b.partySize === 1 ? "guest" : "guests"} · {cardText(b.cardBrand, b.cardLast4)}
        </span>
        <span className="hidden truncate text-[0.9375rem] text-ink-3 @3xl:block">{b.guestEmail}</span>
      </span>
      <span className="hidden truncate text-ink @3xl:block">
        <TableName label={b.tableLabel} className="text-[1.1875rem]" />
      </span>
      <span className="hidden text-base text-ink-2 tabular @3xl:block">{b.partySize}</span>
      <span className="flex flex-col items-end gap-1 @3xl:contents">
        <span className={cx("text-right text-base font-semibold tabular @3xl:block", cancelled ? "text-ink-3" : "text-ink")}>
          {formatMoney(b.priceCents)}
          {b.refundCents ? <span className="block text-sm font-normal text-ink-3">{formatMoney(b.refundCents)} back</span> : null}
        </span>
        <span>
          <StatusDot status={b.status} />
        </span>
      </span>
      <span className="hidden truncate text-[0.9375rem] text-ink-2 tabular @3xl:block">{cardText(b.cardBrand, b.cardLast4)}</span>
    </button>
  );
}

function CloseNotice({ onClose }: { onClose: () => void }) {
  return (
    <button
      type="button"
      onClick={onClose}
      aria-label="Dismiss"
      className="-my-1 inline-flex size-9 items-center justify-center rounded-full hover:bg-black/5"
    >
      <X aria-hidden className="size-4" />
    </button>
  );
}

function Skeleton() {
  return (
    <ul aria-label="Loading bookings" className="divide-y divide-line">
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <li key={i} className="flex items-center gap-4 px-5 py-4">
          <div className="h-5 w-14 animate-pulse rounded-md bg-surface-2" />
          <div className="h-5 flex-1 animate-pulse rounded-md bg-surface-2" />
          <div className="h-6 w-20 animate-pulse rounded-full bg-surface-2" />
        </li>
      ))}
    </ul>
  );
}
