"use client";

import { ArrowLeft } from "lucide-react";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/primitives";
import { BottomSheet } from "@/components/ui/sheet";
import { formatMoney, formatTime } from "@/lib/format";
import { type RoomData, type RoomTable, visualState } from "@/lib/room/types";
import { useRoom } from "@/lib/room/store";
import { ApiFailure, api, suggestionFrom } from "./api";
import { loadSavedHold, saveHold, slotKey, useBooking } from "./booking-store";
import { WidgetHeader } from "./header";
import { useAvailability, useIsDesktop, useReducedMotion } from "./hooks";
import { ListView } from "./list-view";
import { SeatViewImage, TierDot } from "./parts";
import { RoomView } from "./room-view";
import { SlotPicker } from "./slot-picker";
import { TableCard } from "./table-card";
import { turnstileToken } from "./turnstile";

// Hold, details and payment load on first use, keeping them out of the first page load.
const Flow = dynamic(() => import("./flow").then((m) => m.Flow), {
  ssr: false,
  loading: () => <div className="m-5 h-64 animate-pulse rounded-card bg-surface-2" aria-busy />,
});

export interface GuestWidgetProps {
  data: RoomData;
  today: string;
  turnstileSiteKey: string;
  turnstileMode: "live" | "offline-test";
  embedded?: boolean;
}

/**
 * The guest widget (PRD guest experience): the room first, then a time, then a
 * table card with the view from the seat, then hold and pay.
 */
export function GuestWidget({ data, today, turnstileSiteKey, turnstileMode, embedded }: GuestWidgetProps) {
  const { venue } = data;
  const isDesktop = useIsDesktop();
  const reduced = useReducedMotion();
  const view = useRoom((s) => s.view);
  const selected = useRoom((s) => s.selected);
  const slot = useRoom((s) => s.slot);
  const party = useRoom((s) => s.party);
  const select = useRoom((s) => s.select);
  const setSlot = useRoom((s) => s.setSlot);
  const setReducedMotion = useRoom((s) => s.setReducedMotion);
  const step = useBooking((s) => s.step);
  const setNotice = useBooking((s) => s.setNotice);
  const startHold = useBooking((s) => s.startHold);
  const [picking, setPicking] = useState(false);
  const [reserving, setReserving] = useState(false);
  const [sitting, setSitting] = useState<RoomTable | null>(null);
  const [sheetHeight, setSheetHeight] = useState(0);
  const { status: availabilityStatus, error: availabilityError } = useAvailability(venue.id);

  useEffect(() => setReducedMotion(reduced), [reduced, setReducedMotion]);

  // The 2D plan is interactive once the widget has hydrated (PRD G-1 budget).
  useEffect(() => {
    performance.mark("pyt:interactive");
    useRoom.getState().setRenderer("2d");
  }, []);

  const largestParty = useMemo(() => Math.max(1, ...data.tables.filter((t) => t.bookable).map((t) => t.maxParty)), [data.tables]);
  const table = data.tables.find((t) => t.id === selected) ?? null;
  const inFlow = step !== "room";

  // Bring back a hold after a reload or a dropped connection.
  useEffect(() => {
    const saved = loadSavedHold(venue.id);
    if (!saved) return;
    const restore = async () => {
      try {
        const s = await api.holdStatus(saved.holdId, saved.token);
        if (s.hold.status === "held") {
          useRoom.getState().setSlot({ date: s.hold.slot.date, time: s.hold.slot.time, party: s.hold.partySize });
          useRoom.getState().select(s.hold.table);
          startHold(s.hold, saved.token);
        } else if (s.hold.status === "confirmed" && s.booking) {
          useBooking.setState({ hold: s.hold, holdToken: saved.token });
          useBooking.getState().confirm(s);
        } else saveHold(null);
      } catch {
        saveHold(null);
      }
    };
    void restore();
  }, [venue.id, startHold]);

  const reserve = useCallback(
    async (t: RoomTable) => {
      const current = useRoom.getState().slot;
      if (!current) return;
      const key = slotKey(current);
      setReserving(true);
      setNotice(null);
      try {
        const token = await turnstileToken(turnstileSiteKey, turnstileMode, "pyt-turnstile");
        const res = await api.createHold(venue.id, {
          table: t.id,
          date: current.date,
          time: current.time,
          party: current.party,
          turnstileToken: token,
        });
        startHold(res.hold, res.holdToken);
      } catch (e) {
        if (e instanceof ApiFailure && e.code === "taken") {
          const alt = suggestionFrom(e);
          // Refresh availability so the room shows the table as taken.
          setSlot({ ...current });
          if (alt) useRoom.getState().select(alt.code);
          setNotice({
            tone: "warning",
            title: "Someone just took this table.",
            body: alt
              ? `${alt.label} is the most similar table that's free, at ${formatMoney(alt.feeCents)}.`
              : "Choose another table or time.",
            table: alt?.code ?? t.id,
            slotKey: key,
          });
        } else if (e instanceof ApiFailure) {
          setNotice({
            tone: e.offline ? "warning" : "danger",
            title: e.offline ? "You're offline." : e.message,
            body: e.offline ? "Check your connection and try again." : undefined,
            table: t.id,
            slotKey: key,
          });
        } else {
          setNotice({ tone: "danger", title: "We couldn't check that you're a person.", body: "Please try again.", table: t.id });
        }
      } finally {
        setReserving(false);
      }
    },
    [venue.id, turnstileSiteKey, turnstileMode, startHold, setNotice, setSlot],
  );

  const rehold = useCallback(async () => {
    const hold = useBooking.getState().hold;
    if (!hold) return;
    const t = data.tables.find((x) => x.id === hold.table);
    if (!t) return;
    useRoom.getState().setSlot({ date: hold.slot.date, time: hold.slot.time, party: hold.partySize });
    setNotice(null);
    try {
      const token = await turnstileToken(turnstileSiteKey, turnstileMode, "pyt-turnstile-rehold");
      const res = await api.createHold(venue.id, {
        table: t.id,
        date: hold.slot.date,
        time: hold.slot.time,
        party: hold.partySize,
        turnstileToken: token,
      });
      startHold(res.hold, res.holdToken);
    } catch (e) {
      const alt = e instanceof ApiFailure && e.code === "taken" ? suggestionFrom(e) : null;
      useBooking.getState().reset();
      useRoom.getState().select(alt?.code ?? t.id);
      setNotice({
        tone: "warning",
        title:
          e instanceof ApiFailure && e.code === "taken"
            ? `${t.label} was booked by someone else.`
            : e instanceof ApiFailure
              ? e.message
              : "Please try again.",
        body: alt ? `${alt.label} is the most similar table that's free.` : undefined,
        table: alt?.code ?? t.id,
      });
    }
  }, [data.tables, venue.id, turnstileSiteKey, turnstileMode, startHold, setNotice]);

  const sitHere = useCallback((t: RoomTable) => {
    const r = useRoom.getState().renderer;
    if (r === "3d") useRoom.getState().sit(t.id);
    else setSitting(t);
  }, []);

  const closeCard = useCallback(() => select(null), [select]);
  const applySlot = (s: { date: string; time: string; party: number }) => {
    setSlot(s);
    setPicking(false);
  };

  const picker = (
    <SlotPicker
      venue={venue}
      today={today}
      initial={slot}
      party={party}
      largestParty={largestParty}
      onApply={applySlot}
      onCancel={() => setPicking(false)}
    />
  );

  return (
    <div data-pyt-root className="flex h-dvh flex-col overflow-hidden bg-surface-0 text-ink">
      <WidgetHeader venue={venue} onPickSlot={() => setPicking(true)} embedded={embedded} />
      <div className="flex min-h-0 flex-1">
        <main className="relative min-w-0 flex-1" aria-label={view === "room" ? "The room" : "Tables"}>
          {view === "room" ? (
            <RoomView data={data} bottomInset={isDesktop ? 0 : table && !inFlow ? sheetHeight : 0} />
          ) : (
            <ListView data={data} />
          )}
          {!isDesktop && !table && !inFlow ? (
            <MobileHint data={data} status={availabilityStatus} error={availabilityError} onPickSlot={() => setPicking(true)} />
          ) : null}
        </main>
        {isDesktop ? (
          <aside className="flex w-[440px] shrink-0 flex-col border-l border-line bg-surface-1" aria-label="Table details">
            {inFlow ? (
              <div className="flex min-h-0 flex-1 flex-col pt-5">
                <Flow data={data} onClose={closeCard} onRehold={() => void rehold()} />
              </div>
            ) : table ? (
              <div className="flex min-h-0 flex-1 flex-col">
                <div className="flex h-12 shrink-0 items-center px-3">
                  <button
                    type="button"
                    onClick={closeCard}
                    className="inline-flex h-9 items-center gap-1.5 rounded-full px-2.5 text-[0.9375rem] text-ink-2 hover:bg-surface-2"
                  >
                    <ArrowLeft aria-hidden className="size-4" />
                    All tables
                  </button>
                </div>
                <TableCard
                  data={data}
                  onPickSlot={() => setPicking(true)}
                  onReserve={(t) => void reserve(t)}
                  onSitHere={sitHere}
                  reserving={reserving}
                />
              </div>
            ) : (
              <EmptyPanel data={data} status={availabilityStatus} error={availabilityError} onPickSlot={() => setPicking(true)} />
            )}
          </aside>
        ) : null}
      </div>

      {!isDesktop ? (
        <>
          <BottomSheet
            open={Boolean(table) && !inFlow && !picking}
            onOpenChange={(o) => !o && closeCard()}
            title={table ? table.label : "Table"}
          >
            <MeasuredHeight onHeight={setSheetHeight}>
              <TableCard
                data={data}
                onPickSlot={() => setPicking(true)}
                onReserve={(t) => void reserve(t)}
                onSitHere={sitHere}
                reserving={reserving}
              />
            </MeasuredHeight>
          </BottomSheet>
          <BottomSheet open={inFlow} onOpenChange={() => undefined} title="Reserve your table" modal full dismissible={false}>
            <Flow data={data} onClose={closeCard} onRehold={() => void rehold()} />
          </BottomSheet>
          <BottomSheet open={picking} onOpenChange={setPicking} title="Choose a date, time and party size" modal>
            {picker}
          </BottomSheet>
        </>
      ) : (
        <Dialog
          open={picking}
          onClose={() => setPicking(false)}
          title=""
          className="w-[min(36rem,calc(100vw-2rem))] [&>div:first-child]:hidden"
        >
          <div className="-mx-6 -mb-4 flex max-h-[80dvh] flex-col pt-6">{picking ? picker : null}</div>
        </Dialog>
      )}

      {sitting?.image ? <SeatOverlay table={sitting} onClose={() => setSitting(null)} /> : null}
      <div id="pyt-turnstile-rehold" className="fixed bottom-4 left-1/2 z-[60] -translate-x-1/2 empty:hidden" />
    </div>
  );
}

function MeasuredHeight({ children, onHeight }: { children: React.ReactNode; onHeight: (h: number) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => onHeight(el.getBoundingClientRect().height + 20));
    ro.observe(el);
    return () => {
      ro.disconnect();
      onHeight(0);
    };
  }, [onHeight]);
  return (
    <div ref={ref} className="flex min-h-0 flex-1 flex-col">
      {children}
    </div>
  );
}

function freeCount(data: RoomData, availability: ReturnType<typeof useRoom.getState>["availability"]) {
  return data.tables.filter((t) => t.bookable && visualState(t, availability?.[t.id]) === "available").length;
}

function MobileHint({
  data,
  status,
  error,
  onPickSlot,
}: {
  data: RoomData;
  status: string;
  error: string | null;
  onPickSlot: () => void;
}) {
  const slot = useRoom((s) => s.slot);
  const availability = useRoom((s) => s.availability);
  const free = freeCount(data, availability);
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center px-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
      <div className="pointer-events-auto flex w-full max-w-md items-center gap-3 rounded-sheet bg-surface-1 py-3 pr-3 pl-4 shadow-pop">
        <p className="min-w-0 flex-1 text-[0.9375rem] leading-snug text-ink-2">
          {error ? (
            <span className="text-danger">{error}</span>
          ) : slot && status !== "loading" ? (
            <>
              <span className="font-medium text-ink tabular">
                {free === 0 ? "No tables free" : `${free} tables free`} at {formatTime(slot.time)}.
              </span>{" "}
              Tap one to see its view.
            </>
          ) : (
            <>Tap a table to see the view from its seat.</>
          )}
        </p>
        {!slot ? (
          <Button size="md" onClick={onPickSlot}>
            Choose a time
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function EmptyPanel({
  data,
  status,
  error,
  onPickSlot,
}: {
  data: RoomData;
  status: string;
  error: string | null;
  onPickSlot: () => void;
}) {
  const slot = useRoom((s) => s.slot);
  const availability = useRoom((s) => s.availability);
  const free = freeCount(data, availability);
  const tiers = data.venue.tiers.filter((t) => data.tables.some((x) => x.tier === t.id && x.bookable));
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-6 pt-8 pb-6">
      <h2 className="font-display text-display-l">Choose your table</h2>
      <p className="mt-2 text-ink-2">
        Explore the room and tap any highlighted table to see the view from its seat. You pay a table fee to guarantee it.
      </p>
      {error ? (
        <p className="mt-4 text-[0.9375rem] text-danger">{error}</p>
      ) : slot && status !== "loading" ? (
        <p className="mt-4 text-[0.9375rem] font-medium tabular">
          {free === 0 ? "No tables are free" : `${free} tables are free`} at {formatTime(slot.time)}.
        </p>
      ) : (
        <Button size="lg" className="mt-6 self-start" onClick={onPickSlot}>
          Choose a date and time
        </Button>
      )}
      <ul className="mt-8 flex flex-col divide-y divide-line border-y border-line">
        {tiers.map((t) => {
          const from = Math.min(...data.tables.filter((x) => x.tier === t.id && x.fromCents != null).map((x) => x.fromCents!));
          return (
            <li key={t.id} className="flex items-start gap-3 py-4">
              <TierDot color={t.color} colorDark={t.colorDark} className="mt-2" />
              <div className="min-w-0 flex-1">
                <p className="font-display text-[1.375rem] leading-tight">{t.name}</p>
                <p className="mt-0.5 text-[0.9375rem] text-ink-2">{t.description}</p>
              </div>
              {Number.isFinite(from) ? (
                <p className="shrink-0 pt-1 text-[0.9375rem] text-ink-2 tabular">from {formatMoney(from)}</p>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** "Sit here" without 3D: the seat view, full screen. */
function SeatOverlay({ table, onClose }: { table: RoomTable; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      aria-label={`The view from ${table.label}`}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      className="fixed inset-0 m-0 flex h-dvh max-h-none w-dvw max-w-none flex-col bg-black p-0 text-white backdrop:bg-black"
    >
      <div className="flex min-h-0 flex-1 items-center">
        <SeatViewImage image={table.image!} alt={`The view from ${table.label}`} sizes="100vw" priority />
      </div>
      <div className="flex items-center justify-between gap-3 px-4 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))]">
        <p className="font-display text-2xl">{table.label}</p>
        <button
          type="button"
          onClick={onClose}
          className="inline-flex h-11 items-center gap-2 rounded-full bg-white/15 px-4 font-medium text-white hover:bg-white/25"
        >
          <ArrowLeft aria-hidden className="size-4" />
          Back to the room
        </button>
      </div>
    </dialog>
  );
}
