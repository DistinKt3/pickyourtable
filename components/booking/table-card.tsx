"use client";

import { ChevronLeft, ChevronRight, Eye } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { stateText } from "@/components/room/views";
import { Button } from "@/components/ui/button";
import { Banner, Chip } from "@/components/ui/primitives";
import type { TableTimesResponse } from "@/lib/api/contracts";
import { capitalize, cx, formatDate, formatMoney, formatTime, partyLabel } from "@/lib/format";
import { type RoomData, type RoomTable, tierOf, visualState } from "@/lib/room/types";
import { useRoom } from "@/lib/room/store";
import { ApiFailure, api } from "./api";
import { slotKey, useBooking } from "./booking-store";
import { SeatViewImage, TierDot } from "./parts";

/**
 * The table card (PRD guest step 4): the seat view full-bleed, tier, up to three
 * attributes, seats and the server's fee, with "Reserve this table". Swiping moves
 * to the next available table and the camera follows (PRD G-4).
 */
export function TableCard({
  data,
  onPickSlot,
  onReserve,
  onSitHere,
  reserving,
}: {
  data: RoomData;
  onPickSlot: () => void;
  onReserve: (t: RoomTable) => void;
  onSitHere: (t: RoomTable) => void;
  reserving: boolean;
}) {
  const selected = useRoom((s) => s.selected);
  const availability = useRoom((s) => s.availability);
  const slot = useRoom((s) => s.slot);
  const select = useRoom((s) => s.select);
  const reducedMotion = useRoom((s) => s.reducedMotion);
  const rawNotice = useBooking((s) => s.notice);
  const table = data.tables.find((t) => t.id === selected) ?? null;
  const notice =
    rawNotice &&
    (!rawNotice.table || rawNotice.table === selected) &&
    (rawNotice.slotKey === undefined || rawNotice.slotKey === slotKey(slot))
      ? rawNotice
      : null;

  const deck = useMemo(() => {
    if (!table) return [];
    if (!table.bookable) return [table];
    return data.tables.filter(
      (t) => t.id === table.id || (t.bookable && (!availability || visualState(t, availability[t.id]) === "available")),
    );
  }, [data.tables, table, availability]);

  const index = Math.max(
    0,
    deck.findIndex((t) => t.id === selected),
  );
  const scroller = useRef<HTMLDivElement>(null);
  const settling = useRef(false);

  // Follow the selection made elsewhere (a tap in the room, the list, a suggestion).
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const target = index * el.clientWidth;
    if (Math.abs(el.scrollLeft - target) > 2) {
      settling.current = true;
      el.scrollTo({ left: target, behavior: reducedMotion ? "auto" : "smooth" });
      const id = setTimeout(() => (settling.current = false), 450);
      return () => clearTimeout(id);
    }
  }, [index, reducedMotion]);

  const onScrollEnd = useCallback(() => {
    const el = scroller.current;
    if (!el || settling.current) return;
    const i = Math.round(el.scrollLeft / el.clientWidth);
    const t = deck[i];
    if (t && t.id !== selected) select(t.id);
  }, [deck, selected, select]);

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onScroll = () => {
      clearTimeout(timer);
      timer = setTimeout(onScrollEnd, 110);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      clearTimeout(timer);
      el.removeEventListener("scroll", onScroll);
    };
  }, [onScrollEnd]);

  if (!table) return null;
  const a = availability?.[table.id];
  const state = visualState(table, a);
  const fee = a?.feeCents ?? null;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="relative">
        <div
          ref={scroller}
          data-vaul-no-drag
          data-carousel
          className="flex snap-x snap-mandatory overflow-x-auto overscroll-x-contain scrollbar-none"
        >
          {deck.map((t) => (
            <div
              key={t.id}
              className="w-full shrink-0 snap-center snap-always"
              aria-hidden={t.id !== table.id}
              inert={t.id !== table.id}
            >
              <CardMedia table={t} onSitHere={() => onSitHere(t)} priority={t.id === table.id} />
            </div>
          ))}
        </div>
        {deck.length > 1 ? (
          <div className="pointer-events-none absolute inset-x-0 bottom-3 flex items-center justify-between px-3">
            <SlideButton
              label="Previous table"
              disabled={index === 0}
              onClick={() => deck[index - 1] && select(deck[index - 1]!.id)}
            >
              <ChevronLeft className="size-5" aria-hidden />
            </SlideButton>
            <span className="rounded-full bg-black/45 px-2.5 py-1 text-[0.8125rem] font-medium text-white tabular backdrop-blur-[6px]">
              {index + 1} of {deck.length}
            </span>
            <SlideButton
              label="Next table"
              disabled={index >= deck.length - 1}
              onClick={() => deck[index + 1] && select(deck[index + 1]!.id)}
            >
              <ChevronRight className="size-5" aria-hidden />
            </SlideButton>
          </div>
        ) : null}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 pt-4 pb-3">
        {notice ? (
          <Banner tone={notice.tone === "neutral" ? "neutral" : notice.tone} title={notice.title} className="mb-4">
            {notice.body}
          </Banner>
        ) : null}
        <CardDetails data={data} table={table} fee={fee} />
        <StateHelp key={`${table.id}|${slotKey(slot)}`} data={data} table={table} onPickSlot={onPickSlot} />
      </div>

      <div className="shrink-0 border-t border-line px-5 pt-3 pb-4">
        {slot ? (
          <div className="mb-2.5 flex items-center justify-between gap-3 text-[0.9375rem] text-ink-2 tabular">
            <span>
              {formatDate(slot.date)} · {formatTime(slot.time)} · {partyLabel(slot.party)}
            </span>
            <button
              type="button"
              onClick={onPickSlot}
              className="min-h-9 rounded-md px-1 font-medium text-accent hover:underline"
            >
              Change
            </button>
          </div>
        ) : null}
        {!table.bookable ? (
          <p className="text-[0.9375rem] text-ink-2">
            Main-floor tables are seated by the host on arrival. Choose a highlighted table to guarantee your seat.
          </p>
        ) : !slot ? (
          <Button size="lg" block onClick={onPickSlot}>
            Choose a time{table.fromCents != null ? ` · from ${formatMoney(table.fromCents)}` : ""}
          </Button>
        ) : state === "available" && fee != null ? (
          <Button size="lg" block loading={reserving} onClick={() => onReserve(table)}>
            Reserve this table &ndash; {formatMoney(fee)}
          </Button>
        ) : state === "wrong_size" ? (
          <Button size="lg" block variant="secondary" onClick={onPickSlot}>
            Change party size
          </Button>
        ) : (
          <Button size="lg" block variant="secondary" onClick={onPickSlot}>
            Choose another time
          </Button>
        )}
        <div id="pyt-turnstile" className="mt-2 flex justify-center empty:hidden" />
      </div>
    </div>
  );
}

function SlideButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="pointer-events-auto inline-flex size-9 items-center justify-center rounded-full bg-black/45 text-white backdrop-blur-[6px] transition-opacity duration-150 hover:bg-black/60 disabled:opacity-0"
    >
      {children}
    </button>
  );
}

function CardMedia({ table, onSitHere, priority }: { table: RoomTable; onSitHere: () => void; priority: boolean }) {
  if (!table.image) {
    return (
      <div className="flex aspect-[3/1] items-end bg-[linear-gradient(180deg,var(--surface-2),var(--surface-3))] px-5 pb-4">
        <p className="text-[0.9375rem] text-ink-2">No seat view for main-floor tables.</p>
      </div>
    );
  }
  return (
    <div className="relative">
      <SeatViewImage image={table.image} alt={`The view from ${table.label}`} priority={priority} />
      <button
        type="button"
        onClick={onSitHere}
        className="absolute top-3 right-3 inline-flex h-9 items-center gap-1.5 rounded-full bg-surface-1/95 px-3.5 text-[0.9375rem] font-medium text-ink shadow-chip transition-colors duration-150 hover:bg-surface-1"
      >
        <Eye aria-hidden className="size-4" strokeWidth={1.75} />
        Sit here
      </button>
    </div>
  );
}

function CardDetails({ data, table, fee }: { data: RoomData; table: RoomTable; fee: number | null }) {
  const tier = tierOf(data.venue, table.tier);
  // The tier already says "Window" or "Booth"; don't repeat it as a chip.
  const chips = table.attributes.filter((x) => x.toLowerCase() !== tier.name.toLowerCase()).slice(0, 3);
  return (
    <>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="font-display text-[2rem] leading-[1.05]">{table.label}</h2>
          <p className="mt-1.5 flex items-center gap-2 text-[0.9375rem] text-ink-2">
            <TierDot color={tier.color} colorDark={tier.colorDark} />
            {tier.name} · {table.seats} seats
          </p>
        </div>
        {table.bookable ? (
          <div className="shrink-0 pt-1 text-right">
            <p className="text-[1.375rem] leading-none font-semibold tabular">
              {fee != null ? formatMoney(fee) : table.fromCents != null ? `from ${formatMoney(table.fromCents)}` : ""}
            </p>
            <p className="mt-1 text-sm text-ink-3">table fee</p>
          </div>
        ) : null}
      </div>
      {chips.length ? (
        <ul className="mt-3.5 flex flex-wrap gap-2" aria-label="Features">
          {chips.map((x) => (
            <li key={x}>
              <Chip>{capitalize(x)}</Chip>
            </li>
          ))}
        </ul>
      ) : null}
      <p className="mt-4 hidden text-[0.9375rem] leading-relaxed text-ink-2 lg:block">{tier.description}</p>
      {table.bookable ? (
        <p className="mt-2 hidden text-sm leading-relaxed text-ink-3 lg:block">
          The table fee guarantees this exact table. It&rsquo;s charged now and is separate from your bill.
        </p>
      ) : null}
    </>
  );
}

/** Why a table is dimmed, and what to do instead (PRD guest states). */
function StateHelp({ data, table, onPickSlot }: { data: RoomData; table: RoomTable; onPickSlot: () => void }) {
  const availability = useRoom((s) => s.availability);
  const slot = useRoom((s) => s.slot);
  const setSlot = useRoom((s) => s.setSlot);
  const alternatives = useBooking((s) => s.alternatives);
  const [times, setTimes] = useState<TableTimesResponse["times"] | null>(null);
  const [timesError, setTimesError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const a = availability?.[table.id];
  const state = visualState(table, a);

  if (!table.bookable || !slot) return null;

  const loadTimes = async () => {
    setLoading(true);
    try {
      const res = await api.tableTimes(data.venue.id, table.id, slot.date, slot.time, slot.party);
      setTimes(res.times);
    } catch (e) {
      setTimesError(e instanceof ApiFailure ? e.message : "Could not load times.");
    } finally {
      setLoading(false);
    }
  };

  const tierFree = data.tables.some(
    (t) => t.tier === table.tier && t.bookable && visualState(t, availability?.[t.id]) === "available",
  );
  const nearest = !tierFree ? (alternatives[table.tier] ?? []) : [];
  const tier = tierOf(data.venue, table.tier);

  return (
    <div className="mt-4 flex flex-col gap-3">
      {state === "taken" ? (
        <p className="text-[0.9375rem] text-ink-2">
          {table.label} is taken at {formatTime(slot.time)}.
        </p>
      ) : null}
      {state === "wrong_size" ? (
        <p className="text-[0.9375rem] text-ink-2">{a?.reason ?? `${stateText(table, a)}. Your party is ${slot.party}.`}</p>
      ) : null}
      {nearest.length ? (
        <div>
          <p className="text-[0.9375rem] text-ink-2">
            No {tier.name.toLowerCase()} table is free at {formatTime(slot.time)}. Nearest times with one free:
          </p>
          <TimeChips
            times={nearest.map((n) => ({ key: n.time, label: formatTime(n.time) }))}
            onPick={(time) => setSlot({ ...slot, time })}
          />
        </div>
      ) : null}
      {times ? (
        times.length ? (
          <div>
            <p className="text-[0.9375rem] text-ink-2">Next free times for {table.label}:</p>
            <TimeChips
              times={times.map((t) => ({
                key: `${t.date} ${t.time}`,
                label: t.date === slot.date ? formatTime(t.time) : `${formatDate(t.date)}, ${formatTime(t.time)}`,
              }))}
              onPick={(key) => {
                const [date, time] = key.split(" ") as [string, string];
                setSlot({ date, time, party: slot.party });
              }}
            />
          </div>
        ) : (
          <p className="text-[0.9375rem] text-ink-2">No free times for {table.label} in the next few weeks.</p>
        )
      ) : (
        <button
          type="button"
          onClick={() => void loadTimes()}
          disabled={loading}
          className="self-start text-[0.9375rem] font-medium text-accent hover:underline disabled:text-ink-3"
        >
          {loading ? "Finding times" : "Find other times for this table"}
        </button>
      )}
      {timesError ? <p className="text-sm text-danger">{timesError}</p> : null}
      {state === "wrong_size" ? null : (
        <button type="button" className="sr-only" onClick={onPickSlot}>
          Change date, time or party
        </button>
      )}
    </div>
  );
}

function TimeChips({ times, onPick }: { times: { key: string; label: string }[]; onPick: (key: string) => void }) {
  return (
    <div className="mt-2 flex flex-wrap gap-2">
      {times.map((t) => (
        <button
          key={t.key}
          type="button"
          onClick={() => onPick(t.key)}
          className={cx(
            "h-10 rounded-full bg-surface-1 px-3.5 text-[0.9375rem] font-medium tabular hairline transition-colors duration-150 hover:bg-surface-2",
          )}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
