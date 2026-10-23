"use client";

import { Mail, Phone, Send } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { TextArea } from "@/components/ui/field";
import { Badge, Banner, Dialog } from "@/components/ui/primitives";
import type { PortalReservation, ReservationActionResponse } from "@/lib/api/contracts";
import { formatDate, formatMoney, formatTime, occasionLabel, partyLabel } from "@/lib/format";
import { PortalError, portalFetch } from "@/lib/portal/client";
import type { HistoryEntry } from "@/lib/portal/schemas";
import { TableName } from "../ui";
import { cardText, STATUS_LABEL, STATUS_TONE } from "./format";

/**
 * A booking's detail: guest contact, occasion and note, payment and refund history,
 * and the actions each role may take. Resending is for every role; cancelling with
 * a full refund is Owner-only, and asks for a reason first.
 */
export function BookingDetail({
  booking: b,
  isOwner,
  timezone,
  canCancel,
  labels,
  onClose,
  onChanged,
}: {
  booking: PortalReservation;
  isOwner: boolean;
  timezone: string;
  canCancel: boolean;
  /** Table code to label, for guests seated somewhere else. */
  labels: Record<string, string>;
  onClose: () => void;
  onChanged: (b: PortalReservation, message: string) => void;
}) {
  const [history, setHistory] = useState<HistoryEntry[] | null>(null);
  const [resend, setResend] = useState<{ busy: boolean; message: string | null; error: string | null }>({
    busy: false,
    message: null,
    error: null,
  });
  const [cancelling, setCancelling] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    portalFetch<{ history: HistoryEntry[] }>(`/api/portal/reservations/${b.id}/history`, { signal: controller.signal })
      .then((r) => setHistory(r.history))
      .catch(() => setHistory([]));
    return () => controller.abort();
  }, [b.id]);

  async function sendAgain() {
    setResend({ busy: true, message: null, error: null });
    try {
      await portalFetch(`/api/portal/reservations/${b.id}/resend`, { method: "POST" });
      setResend({ busy: false, message: `Confirmation sent to ${b.guestEmail}.`, error: null });
    } catch (e) {
      setResend({
        busy: false,
        message: null,
        error: e instanceof PortalError ? e.message : "The email didn't send. Try again.",
      });
    }
  }

  const occasion = occasionLabel(b.occasion);
  const at = (iso: string) =>
    new Intl.DateTimeFormat("en-US", { timeZone: timezone, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
      .format(new Date(iso))
      .replace(" AM", " am")
      .replace(" PM", " pm");

  if (cancelling) {
    // One dialog at a time: the shared Dialog labels itself by a fixed id.
    return (
      <CancelDialog
        booking={b}
        onClose={() => setCancelling(false)}
        onDone={(next, refund) => onChanged(next, `Cancelled. ${formatMoney(refund)} refunded to ${b.guestName}.`)}
      />
    );
  }

  return (
    <>
      <Dialog
        open
        onClose={onClose}
        title={b.guestName}
        className="w-[min(36rem,calc(100vw-2rem))]"
        footer={
          <>
            {isOwner && canCancel ? (
              <button
                type="button"
                onClick={() => setCancelling(true)}
                className="inline-flex min-h-11 items-center justify-center rounded-control px-4 text-base font-medium text-danger transition-colors hover:bg-danger-surface sm:mr-auto sm:-ml-4"
              >
                Cancel with full refund
              </button>
            ) : null}
            <Button variant="secondary" onClick={onClose}>
              Close
            </Button>
            {b.status !== "cancelled" ? (
              <Button loading={resend.busy} onClick={() => void sendAgain()} icon={<Send aria-hidden className="size-4" />}>
                Resend confirmation
              </Button>
            ) : null}
          </>
        }
      >
        <div className="-mt-1 mb-5 flex flex-wrap items-center gap-2">
          <Badge tone={STATUS_TONE[b.status]}>{STATUS_LABEL[b.status]}</Badge>
          <span className="text-[0.9375rem] text-ink-3 tabular">Booked {at(b.createdAt)}</span>
        </div>

        <dl className="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-x-4 gap-y-3 text-base">
          <dt className="text-ink-3">When</dt>
          <dd className="text-ink tabular">
            {formatDate(b.slot.date, { weekday: "long" })} at {formatTime(b.slot.time)}
            <span className="text-ink-3"> · {b.slot.daypartName}</span>
          </dd>
          <dt className="text-ink-3">Table</dt>
          <dd className="text-ink">
            <TableName label={b.tableLabel} className="text-[1.25rem] leading-tight" />
            {b.seatedTable && b.seatedTable !== b.table ? (
              <span className="text-ink-3"> · seated at {labels[b.seatedTable] ?? b.seatedTable}</span>
            ) : null}
          </dd>
          <dt className="text-ink-3">Party</dt>
          <dd className="text-ink tabular">{partyLabel(b.partySize)}</dd>
          {occasion ? (
            <>
              <dt className="text-ink-3">Occasion</dt>
              <dd className="text-ink">{occasion}</dd>
            </>
          ) : null}
          {b.note ? (
            <>
              <dt className="text-ink-3">Note</dt>
              <dd className="text-pretty text-ink">{b.note}</dd>
            </>
          ) : null}
        </dl>

        <h3 className="mt-6 mb-2 text-sm font-medium tracking-[0.06em] text-ink-3 uppercase">Contact</h3>
        <div className="flex flex-col gap-1">
          <a
            href={`mailto:${b.guestEmail}`}
            className="flex min-h-11 items-center gap-3 rounded-control text-ink hover:text-accent"
          >
            <Mail aria-hidden className="size-4 text-ink-3" />
            <span className="break-all">{b.guestEmail}</span>
          </a>
          {b.guestMobile ? (
            <a
              href={`tel:${b.guestMobile.replace(/[^+\d]/g, "")}`}
              className="flex min-h-11 items-center gap-3 rounded-control text-ink tabular hover:text-accent"
            >
              <Phone aria-hidden className="size-4 text-ink-3" />
              {b.guestMobile}
            </a>
          ) : null}
        </div>

        <h3 className="mt-5 mb-2 text-sm font-medium tracking-[0.06em] text-ink-3 uppercase">Payment</h3>
        <div className="rounded-card bg-surface-0 px-4 py-3 hairline">
          <div className="flex items-baseline justify-between gap-4">
            <span className="text-ink">Table fee</span>
            <span className="font-semibold text-ink tabular">{formatMoney(b.priceCents)}</span>
          </div>
          <div className="mt-1 flex items-baseline justify-between gap-4 text-[0.9375rem] text-ink-3">
            <span>{cardText(b.cardBrand, b.cardLast4)}</span>
            <span>{b.paid ? "Paid" : "Not paid"}</span>
          </div>
          <div className="mt-3 flex items-baseline justify-between gap-4 border-t border-line pt-3">
            <span className="text-ink">Refunded</span>
            <span className={b.refundCents ? "font-semibold text-ink tabular" : "text-ink-3 tabular"}>
              {b.refundCents ? formatMoney(b.refundCents) : "Nothing refunded"}
            </span>
          </div>
        </div>

        <h3 className="mt-5 mb-2 text-sm font-medium tracking-[0.06em] text-ink-3 uppercase">History</h3>
        {history === null ? (
          <div className="h-12 animate-pulse rounded-card bg-surface-2" />
        ) : history.length === 0 ? (
          <p className="text-[0.9375rem] text-ink-3">No changes since it was booked.</p>
        ) : (
          <ol className="flex flex-col gap-2">
            {history.map((h) => (
              <li
                key={`${h.at}-${h.action}-${h.amountCents ?? ""}`}
                className="flex items-baseline justify-between gap-4 text-[0.9375rem]"
              >
                <span className="text-ink">
                  {h.label}
                  {h.amountCents ? <span className="text-ink-2 tabular"> · {formatMoney(h.amountCents)}</span> : null}
                  {h.actor ? <span className="text-ink-3"> · {h.actor}</span> : null}
                </span>
                <span className="shrink-0 text-ink-3 tabular">{at(h.at)}</span>
              </li>
            ))}
          </ol>
        )}

        {resend.message ? (
          <Banner tone="success" className="mt-5">
            {resend.message}
          </Banner>
        ) : null}
        {resend.error ? (
          <Banner tone="danger" className="mt-5">
            {resend.error}
          </Banner>
        ) : null}
      </Dialog>
    </>
  );
}

function CancelDialog({
  booking: b,
  onClose,
  onDone,
}: {
  booking: PortalReservation;
  onClose: () => void;
  onDone: (b: PortalReservation, refundCents: number) => void;
}) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const refund = b.priceCents - b.refundCents;

  async function confirm() {
    if (reason.trim().length < 2) {
      setError('Add a short reason, such as "Kitchen closed early".');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await portalFetch<ReservationActionResponse>(`/api/portal/reservations/${b.id}/cancel`, {
        method: "POST",
        body: { reason: reason.trim() },
      });
      onDone(res.reservation, res.refundCents);
    } catch (e) {
      setBusy(false);
      setError(e instanceof PortalError ? e.message : "The cancellation didn't go through. Nothing was refunded.");
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={`Cancel and refund ${formatMoney(refund)}?`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Keep booking
          </Button>
          <Button variant="danger" loading={busy} onClick={() => void confirm()}>
            Cancel and refund {formatMoney(refund)}
          </Button>
        </>
      }
    >
      <p className="text-base">
        This cancels {b.guestName}&rsquo;s booking for <span className="font-semibold text-ink">{b.tableLabel}</span> on{" "}
        {formatDate(b.slot.date, { weekday: "long" })} at {formatTime(b.slot.time)}, refunds the full {formatMoney(refund)} to
        their {cardText(b.cardBrand, b.cardLast4)} and emails them.
      </p>
      <TextArea
        className="mt-5"
        label="Reason"
        hint="Saved in the booking's history."
        value={reason}
        maxLength={200}
        onChange={(e) => setReason(e.target.value)}
        error={error}
      />
    </Dialog>
  );
}
