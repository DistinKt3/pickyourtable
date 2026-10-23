"use client";

import { CalendarOff, Trash } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { SelectField, TextField } from "@/components/ui/field";
import { Banner, Dialog, Segmented, Switch } from "@/components/ui/primitives";
import type { BlackoutView } from "@/lib/api/contracts";
import { addDays, formatDate, formatMoney, formatTime } from "@/lib/format";
import { PortalError, portalFetch } from "@/lib/portal/client";
import type { CreateBlackoutResponse, OverlappingBooking, OverlapsResponse } from "@/lib/portal/schemas";
import { END_OF_DAY } from "@/lib/portal/time";
import { EmptyState, PageHeader, Panel, SectionTitle, TableName } from "../ui";

/**
 * Blackouts (PRD O-4, Owner): block one table or the whole venue for a time range on
 * a date, in the venue's own time. Confirmed bookings in the range are listed as a
 * warning before saving; they are not cancelled.
 */

type Scope = "table" | "venue";

const when = (b: Pick<BlackoutView, "from" | "to">) =>
  b.from === "00:00" && b.to === END_OF_DAY
    ? "All day"
    : `${formatTime(b.from)} to ${b.to === END_OF_DAY ? "close" : formatTime(b.to)}`;

export function BlackoutsScreen({
  initial,
  tables,
  today,
  zoneName,
}: {
  initial: BlackoutView[];
  tables: { code: string; label: string; bookable: boolean }[];
  today: string;
  zoneName: string;
}) {
  const [blackouts, setBlackouts] = useState(initial);
  const [scope, setScope] = useState<Scope>("table");
  const [table, setTable] = useState(tables.find((t) => t.bookable)?.code ?? tables[0]?.code ?? "");
  const [date, setDate] = useState(today);
  const [allDay, setAllDay] = useState(false);
  const [from, setFrom] = useState("17:00");
  const [to, setTo] = useState("22:00");
  const [reason, setReason] = useState("");
  const [overlaps, setOverlaps] = useState<OverlappingBooking[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<CreateBlackoutResponse | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [removing, setRemoving] = useState<BlackoutView | null>(null);

  const start = allDay ? "00:00" : from;
  const end = allDay ? END_OF_DAY : to;
  const rangeOk =
    /^\d{4}-\d{2}-\d{2}$/.test(date) && date >= today && /^\d{2}:\d{2}$/.test(start) && /^\d{2}:\d{2}$/.test(end) && start < end;
  const label = (code: string | null) => (code ? (tables.find((t) => t.code === code)?.label ?? code) : "Whole venue");
  const warnings = rangeOk ? overlaps : [];

  // Warn about confirmed bookings in the range while the owner fills in the form.
  useEffect(() => {
    if (!rangeOk) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      const params = new URLSearchParams({ date, from: start, to: end });
      if (scope === "table") params.set("table", table);
      portalFetch<OverlapsResponse>(`/api/portal/blackouts/overlaps?${params}`, { signal: controller.signal })
        .then((r) => setOverlaps(r.overlapping))
        .catch(() => setOverlaps([]));
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [rangeOk, date, start, end, scope, table]);

  async function submit() {
    const next: Record<string, string> = {};
    if (!rangeOk) next.time = date < today ? "Choose today or a later date." : "The end time must be after the start time.";
    if (reason.trim().length < 2) next.reason = 'Add a short reason, such as "Private event".';
    setErrors(next);
    if (Object.keys(next).length) return;
    setBusy(true);
    setFailure(null);
    try {
      const res = await portalFetch<CreateBlackoutResponse>("/api/portal/blackouts", {
        method: "POST",
        body: { table: scope === "table" ? table : null, date, from: start, to: end, reason: reason.trim() },
      });
      setBlackouts((list) => [...list, res.blackout].sort((a, b) => a.startsAt.localeCompare(b.startsAt)));
      setDone(res);
      setReason("");
    } catch (e) {
      setFailure(e instanceof PortalError ? e.message : "The blackout wasn't saved.");
    } finally {
      setBusy(false);
    }
  }

  async function remove(b: BlackoutView) {
    try {
      await portalFetch(`/api/portal/blackouts/${b.id}`, { method: "DELETE" });
      setBlackouts((list) => list.filter((x) => x.id !== b.id));
      setRemoving(null);
      setDone(null);
    } catch (e) {
      setRemoving(null);
      setFailure(e instanceof PortalError ? e.message : "The blackout wasn't removed.");
    }
  }

  const groups = useMemo(() => {
    const out: { date: string; items: BlackoutView[] }[] = [];
    for (const b of blackouts) {
      const last = out.at(-1);
      if (last?.date === b.date) last.items.push(b);
      else out.push({ date: b.date, items: [b] });
    }
    return out;
  }, [blackouts]);

  const dayName = (d: string) =>
    d === today
      ? `Today · ${formatDate(d)}`
      : d === addDays(today, 1)
        ? `Tomorrow · ${formatDate(d)}`
        : formatDate(d, { weekday: "long" });
  const target = scope === "table" ? label(table) : "the whole venue";

  return (
    <div className="pb-12">
      <PageHeader
        title="Blackouts"
        eyebrow="Owner settings"
        description={`Guests see blocked tables as taken within 10 seconds. Times are in ${zoneName}.`}
      />
      <div className="grid grid-cols-1 items-start gap-6 px-4 sm:px-6 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)] lg:px-8">
        <Panel aria-labelledby="new-blackout" className="p-5 sm:p-6">
          <h2 id="new-blackout" className="text-lg font-semibold text-ink">
            Block a table or the room
          </h2>
          <form
            noValidate
            className="mt-4 flex flex-col gap-5"
            onSubmit={(e) => {
              e.preventDefault();
              void submit();
            }}
          >
            <Segmented
              label="What to block"
              value={scope}
              onChange={setScope}
              options={[
                { value: "table", label: "One table" },
                { value: "venue", label: "Whole venue" },
              ]}
              className="self-start"
            />
            <div className={scope === "table" ? "grid grid-cols-1 gap-5 sm:grid-cols-2 sm:gap-3" : ""}>
              {scope === "table" ? (
                <SelectField
                  label="Table"
                  value={table}
                  onChange={(e) => setTable(e.target.value)}
                  options={tables.map((t) => ({ value: t.code, label: t.label }))}
                />
              ) : null}
              <TextField label="Date" type="date" min={today} value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <div className="flex min-h-11 items-center justify-between gap-4">
                <span className="text-[0.9375rem] font-medium text-ink">Time</span>
                <span className="flex items-center gap-3 text-[0.9375rem] text-ink-2">
                  All day
                  <Switch checked={allDay} onChange={setAllDay} label="All day" />
                </span>
              </div>
              {allDay ? (
                <p className="flex h-12 items-center rounded-control bg-surface-2 px-3.5 text-base text-ink-2">
                  The whole day, every service
                </p>
              ) : (
                <div className="grid grid-cols-2 gap-3">
                  <TextField label="From" type="time" step={900} value={from} onChange={(e) => setFrom(e.target.value)} />
                  <TextField
                    label="To"
                    type="time"
                    step={900}
                    value={to}
                    onChange={(e) => setTo(e.target.value)}
                    error={errors.time ?? null}
                  />
                </div>
              )}
              {allDay && errors.time ? <p className="text-sm font-medium text-danger">{errors.time}</p> : null}
            </div>
            <TextField
              label="Reason"
              value={reason}
              maxLength={120}
              onChange={(e) => setReason(e.target.value)}
              error={errors.reason ?? null}
              hint="Only staff see this."
            />

            {warnings.length ? (
              <Banner
                tone="warning"
                title={`${warnings.length} confirmed ${warnings.length === 1 ? "booking is" : "bookings are"} in this time`}
              >
                <ul className="mt-1 flex flex-col gap-0.5 tabular">
                  {warnings.map((b) => (
                    <li key={b.id}>
                      {formatTime(b.time)} · {b.guestName} · {b.tableLabel} · {formatMoney(b.priceCents)}
                    </li>
                  ))}
                </ul>
                <p className="mt-2">
                  Blocking doesn&rsquo;t cancel them. Cancel from Bookings if the guests can&rsquo;t be seated.
                </p>
              </Banner>
            ) : null}
            {failure ? <Banner tone="danger">{failure}</Banner> : null}
            <Button type="submit" size="lg" block loading={busy}>
              Block {target}
            </Button>
          </form>
        </Panel>

        <section aria-labelledby="upcoming-blackouts" className="flex flex-col gap-3">
          <SectionTitle aside={`${blackouts.length} ahead`}>
            <span id="upcoming-blackouts">Coming up</span>
          </SectionTitle>
          {done ? (
            <Banner
              tone={done.overlapping.length ? "warning" : "success"}
              title={`${label(done.blackout.table)} is blocked on ${formatDate(done.blackout.date)}, ${when(done.blackout).toLowerCase()}`}
            >
              {done.overlapping.length ? (
                <>
                  {done.overlapping.length === 1
                    ? "One confirmed booking is"
                    : `${done.overlapping.length} confirmed bookings are`}{" "}
                  still in that time: {done.overlapping.map((b) => `${b.guestName} at ${formatTime(b.time)}`).join(", ")}.{" "}
                  <Link
                    href={`/portal/bookings?q=${encodeURIComponent(done.overlapping[0]!.guestName)}`}
                    className="font-medium underline underline-offset-4"
                  >
                    Open in Bookings
                  </Link>
                </>
              ) : (
                "Guests see it as taken within 10 seconds."
              )}
            </Banner>
          ) : null}
          <Panel>
            {groups.length === 0 ? (
              <EmptyState icon={<CalendarOff className="size-5" strokeWidth={1.75} />} title="Nothing blocked">
                Every bookable table is open to guests.
              </EmptyState>
            ) : (
              groups.map((g) => (
                <div key={g.date} className="border-b border-line last:border-b-0">
                  <h3 className="px-5 pt-4 pb-1 text-[0.9375rem] font-semibold text-ink tabular">{dayName(g.date)}</h3>
                  <ul>
                    {g.items.map((b) => (
                      <li key={b.id} className="flex items-center justify-between gap-4 px-5 py-3">
                        <div className="min-w-0">
                          <p className="text-base text-ink">
                            {b.table ? (
                              <TableName label={label(b.table)} className="text-[1.25rem]" />
                            ) : (
                              <span className="font-semibold">{label(b.table)}</span>
                            )}
                            <span className="text-ink-2 tabular"> · {when(b)}</span>
                          </p>
                          <p className="truncate text-[0.9375rem] text-ink-3">{b.reason}</p>
                        </div>
                        <Button
                          variant="ghost"
                          icon={<Trash aria-hidden className="size-4" />}
                          onClick={() => setRemoving(b)}
                          aria-label={`Remove blackout: ${label(b.table)}, ${formatDate(b.date)}, ${when(b)}`}
                        >
                          Remove
                        </Button>
                      </li>
                    ))}
                  </ul>
                </div>
              ))
            )}
          </Panel>
        </section>
      </div>

      {removing ? (
        <Dialog
          open
          onClose={() => setRemoving(null)}
          title="Remove this blackout?"
          footer={
            <>
              <Button variant="secondary" onClick={() => setRemoving(null)}>
                Keep it
              </Button>
              <Button onClick={() => void remove(removing)}>Remove blackout</Button>
            </>
          }
        >
          <p className="text-base">
            {label(removing.table)} opens to guests again on {formatDate(removing.date, { weekday: "long" })},{" "}
            {when(removing).toLowerCase()}.
          </p>
        </Dialog>
      ) : null}
    </div>
  );
}
