"use client";

import { ConciergeBell, Printer, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Plan2D } from "@/components/room/plan2d/plan2d";
import { Button } from "@/components/ui/button";
import { Banner } from "@/components/ui/primitives";
import type { PortalReservation, ReservationActionResponse, TonightResponse } from "@/lib/api/contracts";
import { addDays, cx, formatDateLong, formatMoney, formatTime } from "@/lib/format";
import type { RoomTable } from "@/lib/room/types";
import type { Venue } from "@/lib/venue/schema";
import { PortalError, portalFetch } from "@/lib/portal/client";
import { localDayRange } from "@/lib/portal/time";
import { arrival, effectiveNow, orderRows, planViews, summarize } from "@/lib/portal/tonight-view";
import { EmptyState, PageHeader, Panel, TableName } from "../ui";
import { BookingRow } from "./booking-row";
import { DateSwitcher } from "./date-switcher";
import { RunSheet } from "./run-sheet";
import { SeatElsewhereDialog } from "./seat-elsewhere";

/**
 * Tonight (PRD O-1). The room plan with every paid table pinned and a time-ordered
 * list. Seated, No-show and Undo update the screen at once (optimistic), then the
 * server's answer replaces them; the list is polled every 1.5 s while the page is
 * visible, so a new booking appears within 2 s.
 */

export const POLL_MS = 1500;
const RETRY_MS = 5000;

type Action = "seat" | "no-show" | "undo";

interface Override {
  status: PortalReservation["status"];
  seatedTable: string | null;
  refundCents: number;
}

export function TonightScreen({
  venue,
  venueName,
  tables,
  today,
  initialDate,
  initial,
  initialError,
  serverNow,
}: {
  venue: Venue;
  venueName: string;
  tables: RoomTable[];
  today: string;
  initialDate: string;
  initial: TonightResponse | null;
  initialError: string | null;
  /** The server's clock when it rendered, so the first paint matches it exactly. */
  serverNow: string;
}) {
  const [date, setDate] = useState(initialDate);
  const [data, setData] = useState<TonightResponse | null>(initial);
  const [error, setError] = useState<string | null>(initialError);
  const [overrides, setOverrides] = useState<Record<string, Override>>({});
  const [pending, setPending] = useState<Record<string, boolean>>({});
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<string | null>(null);
  const [elsewhere, setElsewhere] = useState<PortalReservation | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [clockNow, setClockNow] = useState(() => new Date(serverNow));
  const mutations = useRef(0);
  const listRef = useRef<HTMLOListElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const scrolledFor = useRef<string | null>(null);

  // Switch to this device's clock after hydration, then keep it moving for "Due in" and "late".
  useEffect(() => {
    const tick = () => setClockNow(new Date());
    const first = setTimeout(tick, 0);
    const id = setInterval(tick, 15_000);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, []);

  // Keep the date in the address so a reload stays on it.
  useEffect(() => {
    const url = new URL(window.location.href);
    if (date === today) url.searchParams.delete("date");
    else url.searchParams.set("date", date);
    window.history.replaceState(window.history.state, "", url);
  }, [date, today]);

  // Poll while visible; pause when hidden; resume at once when shown again.
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let controller: AbortController | undefined;
    const schedule = (ms: number) => {
      clearTimeout(timer);
      if (!stopped && document.visibilityState === "visible") timer = setTimeout(() => void tick(), ms);
    };
    const tick = async () => {
      controller?.abort();
      controller = new AbortController();
      const version = mutations.current;
      try {
        const next = await portalFetch<TonightResponse>(`/api/portal/tonight?date=${date}`, { signal: controller.signal });
        if (stopped) return;
        // A Seated or No-show finished while this was in flight: its answer is newer.
        if (version === mutations.current) setData(next);
        setError(null);
        schedule(POLL_MS);
      } catch (e) {
        if (stopped || (e instanceof DOMException && e.name === "AbortError")) return;
        setError(e instanceof PortalError ? e.message : "Tonight can't load right now.");
        schedule(RETRY_MS);
      }
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") void tick();
      else clearTimeout(timer);
    };
    void tick();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stopped = true;
      clearTimeout(timer);
      controller?.abort();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [date]);

  const changeDate = (d: string) => {
    setDate(d);
    setData((cur) => (cur?.date === d ? cur : null));
    setSelected(null);
    setOverrides({});
    setRowErrors({});
  };

  const day = useMemo(() => localDayRange(date, venue.timezone), [date, venue.timezone]);
  const now = effectiveNow(date, today, clockNow, day.end, day.start);
  const readOnly = date < today;
  // A later date is for looking ahead: arrival is marked on the night (the server agrees).
  const ahead = date > today;

  const rows = useMemo(() => {
    const list = (data?.date === date ? data.reservations : []).map((r) => {
      const o = overrides[r.id];
      return o ? Object.assign({}, r, o) : r;
    });
    return orderRows(list);
  }, [data, date, overrides]);

  const effective = useMemo<TonightResponse | null>(
    () => (data && data.date === date ? { ...data, reservations: rows } : null),
    [data, date, rows],
  );
  const views = useMemo(() => planViews(tables, effective, now), [tables, effective, now]);
  const summary = useMemo(() => summarize(rows, now), [rows, now]);
  const labels = useMemo(() => Object.fromEntries(tables.map((t) => [t.id, t.label])), [tables]);

  const act = useCallback(
    async (r: PortalReservation, action: Action, table?: string) => {
      const elsewhereTable = action === "seat" && table && table !== r.table ? table : null;
      const optimistic: Override =
        action === "seat"
          ? { status: "seated", seatedTable: elsewhereTable, refundCents: elsewhereTable ? r.priceCents : r.refundCents }
          : action === "no-show"
            ? { status: "no_show", seatedTable: null, refundCents: r.refundCents }
            : { status: "confirmed", seatedTable: null, refundCents: r.refundCents };
      mutations.current += 1;
      setOverrides((o) => ({ ...o, [r.id]: optimistic }));
      setPending((p) => ({ ...p, [r.id]: true }));
      setRowErrors(({ [r.id]: _gone, ...rest }) => rest);
      try {
        const res = await portalFetch<ReservationActionResponse>(`/api/portal/reservations/${r.id}/${action}`, {
          method: "POST",
          body: action === "seat" ? (elsewhereTable ? { table: elsewhereTable } : {}) : undefined,
        });
        mutations.current += 1;
        setData((d) => (d ? { ...d, reservations: d.reservations.map((x) => (x.id === r.id ? res.reservation : x)) } : d));
        const where = elsewhereTable ? (labels[elsewhereTable] ?? elsewhereTable) : r.tableLabel;
        setAnnouncement(
          action === "seat"
            ? `${r.guestName} seated at ${where}${res.refundCents ? `, ${formatMoney(res.refundCents)} refunded` : ""}.`
            : action === "no-show"
              ? `${r.guestName} marked as a no-show.`
              : `${r.guestName} is back to arriving.`,
        );
      } catch (e) {
        mutations.current += 1;
        const message = e instanceof PortalError ? e.message : "That didn't save. Try again.";
        setRowErrors((m) => ({ ...m, [r.id]: message }));
        setAnnouncement(message);
      } finally {
        setOverrides(({ [r.id]: _done, ...rest }) => rest);
        setPending(({ [r.id]: _done, ...rest }) => rest);
      }
    },
    [labels],
  );

  const selectTable = (code: string | null) => {
    setSelected((cur) => (cur === code ? null : code));
    if (!code) return;
    requestAnimationFrame(() => {
      const row = listRef.current?.querySelector<HTMLElement>(`[data-table="${code}"]`);
      row?.scrollIntoView({
        block: "nearest",
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
      });
    });
  };

  const isToday = date === today;
  const relative = isToday ? null : date === addDays(today, 1) ? "Tomorrow" : date === addDays(today, -1) ? "Yesterday" : null;
  const selectedTable = selected ? tables.find((t) => t.id === selected) : null;
  const loaded = data?.date === date;

  // Open on the guests still to come: scroll past rows already seated or marked, once per date.
  useEffect(() => {
    if (!loaded || scrolledFor.current === date) return;
    scrolledFor.current = date;
    const box = scrollRef.current;
    const next = listRef.current?.querySelector<HTMLElement>("li:not([data-resolved])");
    if (!box || !next || box.scrollHeight <= box.clientHeight) return;
    box.scrollTop += next.getBoundingClientRect().top - box.getBoundingClientRect().top - 4;
  }, [loaded, date]);

  return (
    <div className="tonight md:grid md:h-dvh md:grid-rows-[auto_auto_auto_minmax(0,1fr)] lg:grid-cols-[minmax(0,1fr)_minmax(27rem,1.08fr)] lg:grid-rows-[auto_auto_minmax(0,1fr)] print:block print:h-auto">
      <PageHeader
        className="lg:col-start-2 lg:row-start-1 print:hidden"
        eyebrow={
          <span className="flex flex-wrap items-center gap-x-3">
            {isToday ? formatDateLong(today) : (relative ?? "Bookings for")}
            <LiveStatus error={Boolean(error)} live={isToday} />
          </span>
        }
        title={isToday ? "Tonight" : formatDateLong(date)}
        actions={
          <>
            <DateSwitcher date={date} today={today} onChange={changeDate} />
            <Button
              variant="secondary"
              className="max-sm:hidden"
              onClick={() => window.print()}
              icon={<Printer aria-hidden className="size-4" />}
            >
              Run sheet
            </Button>
          </>
        }
      />

      <div className="px-4 pb-4 sm:px-6 lg:col-start-2 lg:row-start-2 lg:px-8 print:hidden">
        <dl className="flex flex-wrap items-baseline gap-x-5 gap-y-1 text-[0.9375rem] text-ink-2">
          <Stat value={summary.toArrive} label="to arrive" loading={!loaded} />
          {summary.late ? <Stat value={summary.late} label="late" tone="warning" loading={!loaded} /> : null}
          <Stat value={summary.seated} label="seated" loading={!loaded} />
          <Stat value={summary.noShows} label={summary.noShows === 1 ? "no-show" : "no-shows"} loading={!loaded} />
          <Stat value={formatMoney(summary.feesCents)} label="fees" loading={!loaded} />
        </dl>
      </div>

      <section
        aria-label="Room plan"
        className="relative px-4 pb-4 sm:px-6 md:min-h-0 lg:col-start-1 lg:row-span-3 lg:row-start-1 lg:py-4 lg:pr-0 lg:pl-4 print:hidden"
      >
        <Panel className="relative h-72 overflow-hidden sm:h-80 md:aspect-[3/2] md:h-auto md:max-h-[42dvh] md:w-full lg:aspect-auto lg:h-full lg:max-h-none">
          <div className="absolute inset-x-3 top-3 bottom-14">
            <Plan2D
              venue={venue}
              tables={tables}
              views={views}
              ariaLabel={`Room plan, ${isToday ? "tonight" : formatDateLong(date)}`}
              selected={selected}
              onSelect={(code) => selectTable(code)}
              labelFit="compact-first"
            />
          </div>
          <Legend />
        </Panel>
      </section>

      <section
        aria-label="Bookings"
        className="flex min-h-0 flex-col gap-3 px-4 pb-4 sm:px-6 lg:col-start-2 lg:row-start-3 lg:px-8 lg:pb-6 print:hidden"
      >
        {error ? (
          <Banner tone="danger" title="Tonight isn't updating">
            {error} The screen retries every few seconds, so what you see may be out of date.
          </Banner>
        ) : null}
        <Panel className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {selectedTable ? (
            <div className="flex min-h-12 items-center justify-between gap-3 border-b border-line bg-surface-1 py-1 pr-2 pl-5">
              <p className="text-base text-ink-2">
                <TableName label={selectedTable.label} className="text-[1.1875rem] text-ink" /> is highlighted on the plan
              </p>
              <Button variant="ghost" size="sm" onClick={() => setSelected(null)} icon={<X aria-hidden className="size-4" />}>
                Clear
              </Button>
            </div>
          ) : null}
          <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
            {!loaded ? (
              <RowsSkeleton />
            ) : rows.length === 0 ? (
              <EmptyState
                icon={<ConciergeBell className="size-5" strokeWidth={1.75} />}
                title={isToday ? "No paid tables tonight yet" : "No paid tables on this date"}
              >
                {isToday
                  ? "New bookings appear here within 2 seconds of payment."
                  : "Bookings for this date will show here as guests pay."}
              </EmptyState>
            ) : (
              <ol ref={listRef} className="divide-y divide-line">
                {rows.map((r) => (
                  <BookingRow
                    key={r.id}
                    r={r}
                    arrival={arrival(r, now, ahead)}
                    seatedLabel={r.seatedTable && r.seatedTable !== r.table ? (labels[r.seatedTable] ?? r.seatedTable) : null}
                    selected={selected !== null && (r.table === selected || r.seatedTable === selected)}
                    pending={Boolean(pending[r.id])}
                    error={rowErrors[r.id] ?? null}
                    readOnly={readOnly || ahead}
                    onSeat={() => void act(r, "seat")}
                    onSeatElsewhere={() => setElsewhere(r)}
                    onNoShow={() => void act(r, "no-show")}
                    onUndo={() => void act(r, "undo")}
                    onSelectTable={() => selectTable(r.table)}
                  />
                ))}
              </ol>
            )}
          </div>
        </Panel>
      </section>

      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>

      {elsewhere ? (
        <SeatElsewhereDialog
          reservation={elsewhere}
          venue={venue}
          tables={tables}
          data={effective}
          now={now}
          onClose={() => setElsewhere(null)}
          onConfirm={(code) => {
            const r = elsewhere;
            setElsewhere(null);
            void act(r, "seat", code);
          }}
        />
      ) : null}

      <RunSheet
        venueName={venueName}
        date={date}
        rows={rows}
        labels={labels}
        printedAt={formatTime(
          new Intl.DateTimeFormat("en-GB", {
            timeZone: venue.timezone,
            hour: "2-digit",
            minute: "2-digit",
            hourCycle: "h23",
          }).format(clockNow),
        )}
      />
    </div>
  );
}

function Stat({ value, label, tone, loading }: { value: number | string; label: string; tone?: "warning"; loading: boolean }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <dt className="sr-only">{label}</dt>
      <dd
        className={cx("text-xl font-semibold tabular", tone === "warning" ? "text-warning" : "text-ink", loading && "text-ink-3")}
      >
        {loading ? "–" : value}
      </dd>
      <span aria-hidden>{label}</span>
    </div>
  );
}

function LiveStatus({ error, live }: { error: boolean; live: boolean }) {
  return (
    <span
      className={cx("inline-flex items-center gap-1.5 text-[0.9375rem] font-medium", error ? "text-warning" : "text-success")}
    >
      <span aria-hidden className="relative flex size-2">
        {!error && live ? (
          <span className="absolute inset-0 animate-ping rounded-full bg-success opacity-40 motion-reduce:hidden" />
        ) : null}
        <span className={cx("relative size-2 rounded-full", error ? "bg-warning" : "bg-success")} />
      </span>
      {error ? "Reconnecting" : live ? "Live" : "Updating"}
    </span>
  );
}

function Legend() {
  const item = "flex items-center gap-2";
  return (
    <ul
      aria-label="Plan key"
      className="absolute inset-x-4 bottom-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-ink-2"
    >
      <li className={item}>
        <span aria-hidden className="h-4 w-7 rounded-full bg-accent" />
        Paid
      </li>
      <li className={item}>
        <span aria-hidden className="h-4 w-7 rounded-full bg-warning-surface shadow-[inset_0_0_0_1.5px_var(--warning)]" />
        Late
      </li>
      <li className={item}>
        <span aria-hidden className="h-4 w-7 rounded-full bg-success-surface shadow-[inset_0_0_0_1.5px_var(--success)]" />
        Seated
      </li>
      <li className={item}>
        <span
          aria-hidden
          className="h-4 w-7 rounded-full shadow-[inset_0_0_0_1.5px_var(--line-strong)]"
          style={{ background: "repeating-linear-gradient(45deg, var(--line-strong) 0 1.5px, transparent 1.5px 5px)" }}
        />
        Blocked
      </li>
    </ul>
  );
}

function RowsSkeleton() {
  return (
    <ul aria-label="Loading bookings" className="divide-y divide-line">
      {[0, 1, 2, 3, 4].map((i) => (
        <li key={i} className="grid grid-cols-[3.75rem_minmax(0,1fr)] gap-x-4 px-5 py-4">
          <div className="h-6 w-12 animate-pulse rounded-md bg-surface-2" />
          <div className="flex flex-col gap-2.5">
            <div className="h-5 w-2/5 animate-pulse rounded-md bg-surface-2" />
            <div className="h-4 w-1/3 animate-pulse rounded-md bg-surface-2" />
            <div className="mt-2 h-11 w-3/5 self-end animate-pulse rounded-control bg-surface-2" />
          </div>
        </li>
      ))}
    </ul>
  );
}
