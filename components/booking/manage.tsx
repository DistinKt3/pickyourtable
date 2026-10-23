"use client";

import { CalendarPlus, Check } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge, Banner, Dialog } from "@/components/ui/primitives";
import type { ManageResponse } from "@/lib/api/contracts";
import { capitalize, formatDate, formatMoney, formatTime, occasionLabel, partyLabel } from "@/lib/format";
import type { RoomData } from "@/lib/room/types";
import { ApiFailure, api } from "./api";
import { SeatViewImage } from "./parts";

const STATUS: Record<string, { label: string; tone: "success" | "neutral" | "danger" | "accent" }> = {
  confirmed: { label: "Confirmed", tone: "success" },
  seated: { label: "Seated", tone: "accent" },
  cancelled: { label: "Cancelled", tone: "neutral" },
  no_show: { label: "Missed", tone: "danger" },
  expired: { label: "Not completed", tone: "neutral" },
  held: { label: "Not completed", tone: "neutral" },
};

function brandLabel(brand: string | null): string {
  if (!brand) return "your card";
  if (brand === "apple_pay") return "Apple Pay";
  if (brand === "google_pay") return "Google Pay";
  return capitalize(brand);
}

export function ManageBooking({ data, token }: { data: RoomData; token: string }) {
  const [state, setState] = useState<
    { status: "loading" } | { status: "ready"; res: ManageResponse } | { status: "error"; message: string }
  >({
    status: "loading",
  });
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const [done, setDone] = useState<{ refundCents: number } | null>(null);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const res = await api.manage(token);
        if (alive) setState({ status: "ready", res });
      } catch (e) {
        if (alive) setState({ status: "error", message: e instanceof ApiFailure ? e.message : "We couldn't load this booking." });
      }
    };
    void load();
    return () => {
      alive = false;
    };
  }, [token]);

  const venue = data.venue;

  const cancel = async () => {
    setCancelling(true);
    setCancelError(null);
    try {
      const r = await api.cancel(token);
      setDone({ refundCents: r.refundCents });
      setState((prev) =>
        prev.status === "ready"
          ? {
              status: "ready",
              res: {
                ...prev.res,
                canCancel: false,
                booking: { ...prev.res.booking, status: "cancelled", refundCents: r.refundCents },
              },
            }
          : prev,
      );
      setConfirmOpen(false);
    } catch (e) {
      setCancelError(e instanceof ApiFailure ? e.message : "We couldn't cancel this booking. Please try again.");
    } finally {
      setCancelling(false);
    }
  };

  return (
    <main className="mx-auto max-w-xl px-4 pt-6 pb-16 sm:pt-10">
      <header className="mb-6 flex items-center gap-2.5">
        <p className="font-display text-[2rem] leading-none">{venue.name}</p>
        {venue.demo ? <Badge>Demo venue</Badge> : null}
      </header>

      {state.status === "loading" ? (
        <div className="overflow-hidden rounded-sheet bg-surface-1 hairline" aria-busy>
          <div className="aspect-[3/2] animate-pulse bg-surface-2" />
          <div className="space-y-3 p-6">
            <div className="h-8 w-40 animate-pulse rounded-md bg-surface-2" />
            <div className="h-5 w-64 animate-pulse rounded-md bg-surface-2" />
          </div>
        </div>
      ) : state.status === "error" ? (
        <div className="rounded-sheet bg-surface-1 p-6 hairline">
          <h1 className="font-display text-display-m">We can&rsquo;t open this booking</h1>
          <p className="mt-3 text-ink-2">{state.message}</p>
          <p className="mt-3 text-ink-2">
            For help, call {venue.contact.phone} or email{" "}
            <a
              className="font-medium text-ink underline decoration-line-strong underline-offset-4"
              href={`mailto:${venue.contact.email}`}
            >
              {venue.contact.email}
            </a>
            .
          </p>
        </div>
      ) : (
        <BookingView
          data={data}
          res={state.res}
          done={done}
          onCancel={() => {
            setCancelError(null);
            setConfirmOpen(true);
          }}
        />
      )}

      {state.status === "ready" ? (
        <Dialog
          open={confirmOpen}
          onClose={() => setConfirmOpen(false)}
          title="Cancel your booking?"
          footer={
            <>
              <Button variant="secondary" onClick={() => setConfirmOpen(false)}>
                Keep my booking
              </Button>
              <Button variant="danger" loading={cancelling} onClick={() => void cancel()}>
                {state.res.refund.amountCents > 0
                  ? `Cancel and refund ${formatMoney(state.res.refund.amountCents)}`
                  : "Cancel without a refund"}
              </Button>
            </>
          }
        >
          <p>
            {state.res.booking.tableLabel} on {formatDate(state.res.booking.slot.date, { weekday: "long" })} at{" "}
            {formatTime(state.res.booking.slot.time)} will be released.
          </p>
          <p className="mt-3 font-medium text-ink">{state.res.refund.explanation}</p>
          {cancelError ? (
            <Banner tone="danger" className="mt-4">
              {cancelError}
            </Banner>
          ) : null}
        </Dialog>
      ) : null}
    </main>
  );
}

function BookingView({
  data,
  res,
  done,
  onCancel,
}: {
  data: RoomData;
  res: ManageResponse;
  done: { refundCents: number } | null;
  onCancel: () => void;
}) {
  const b = res.booking;
  const table = data.tables.find((t) => t.id === b.table);
  const status = STATUS[b.status] ?? STATUS.confirmed!;
  const occasion = occasionLabel(b.occasion);
  return (
    <article className="overflow-hidden rounded-sheet bg-surface-1 hairline">
      {table?.image ? (
        <SeatViewImage
          image={table.image}
          alt={`The view from ${b.tableLabel}`}
          sizes="(min-width: 640px) 576px, 100vw"
          priority
        />
      ) : null}
      <div className="p-6">
        {done ? (
          <Banner tone="success" title="Your booking is cancelled" className="mb-5">
            {done.refundCents > 0
              ? `${formatMoney(done.refundCents)} is on its way back to ${brandLabel(b.cardBrand)}${b.cardLast4 && b.cardBrand !== "apple_pay" && b.cardBrand !== "google_pay" ? ` ending ${b.cardLast4}` : ""}. It can take 5 to 10 days to appear.`
              : "We've let the venue know."}
          </Banner>
        ) : null}
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="font-display text-display-l">{b.tableLabel}</h1>
            <p className="mt-1 text-ink-2">{b.tierName}</p>
          </div>
          <Badge tone={status.tone}>{status.label}</Badge>
        </div>
        <dl className="mt-5 grid grid-cols-[auto_1fr] gap-x-6 gap-y-2.5 text-[0.9375rem] tabular">
          <dt className="text-ink-3">Date</dt>
          <dd>{formatDate(b.slot.date, { weekday: "long", year: true })}</dd>
          <dt className="text-ink-3">Time</dt>
          <dd>{formatTime(b.slot.time)}</dd>
          <dt className="text-ink-3">Party</dt>
          <dd>{partyLabel(b.partySize)}</dd>
          <dt className="text-ink-3">Name</dt>
          <dd>{b.guestName}</dd>
          {occasion ? (
            <>
              <dt className="text-ink-3">Occasion</dt>
              <dd>{occasion}</dd>
            </>
          ) : null}
          <dt className="text-ink-3">Table fee</dt>
          <dd>
            {formatMoney(b.priceCents)} paid{b.refundCents > 0 ? `, ${formatMoney(b.refundCents)} refunded` : ""}
          </dd>
        </dl>
        {b.note ? <p className="mt-4 rounded-card bg-surface-2 px-4 py-3 text-[0.9375rem] text-ink-2">{b.note}</p> : null}

        {b.status === "confirmed" && !done ? (
          <>
            <div className="mt-6 flex flex-col gap-2 sm:flex-row">
              <a
                href={res.calendarUrl}
                download
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-control bg-surface-1 px-4 font-medium hairline hover:bg-surface-2"
              >
                <CalendarPlus aria-hidden className="size-4" strokeWidth={1.75} />
                Add to calendar
              </a>
              {res.canCancel ? (
                <Button variant="secondary" onClick={onCancel} className="text-danger">
                  Cancel booking
                </Button>
              ) : null}
            </div>
            <p className="mt-4 flex items-start gap-2 text-sm leading-relaxed text-ink-3">
              <Check aria-hidden className="mt-0.5 size-4 shrink-0" />
              {res.refund.explanation}
            </p>
          </>
        ) : null}
      </div>
    </article>
  );
}
