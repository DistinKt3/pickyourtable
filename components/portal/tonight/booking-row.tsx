"use client";

import { ArrowRightLeft, Check, CircleSlash, Clock, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/primitives";
import type { PortalReservation } from "@/lib/api/contracts";
import { cx, formatMoney, formatTime, occasionLabel, partyLabel } from "@/lib/format";
import { type Arrival, arrivalText, canMarkNoShow } from "@/lib/portal/tonight-view";
import { TableName } from "../ui";

/**
 * One booking on Tonight: time, guest, party, table, occasion and note, the PAID
 * badge with the fee, where they are, and the host's actions. Big type and one tap
 * per action. Guests already seated, no-shows and cancellations fold to one compact
 * line, with an Undo wherever no refund has gone out.
 */
export function BookingRow({
  r,
  arrival,
  seatedLabel,
  selected,
  pending,
  error,
  readOnly,
  onSeat,
  onSeatElsewhere,
  onNoShow,
  onUndo,
  onSelectTable,
}: {
  r: PortalReservation;
  arrival: Arrival;
  /** Label of the table they sit at, when not the one they paid for. */
  seatedLabel: string | null;
  selected: boolean;
  pending: boolean;
  error: string | null;
  readOnly: boolean;
  onSeat: () => void;
  onSeatElsewhere: () => void;
  onNoShow: () => void;
  onUndo: () => void;
  onSelectTable: () => void;
}) {
  const [time, meridiem] = formatTime(r.slot.time).split(" ") as [string, string];
  const occasion = occasionLabel(r.occasion);
  const resolved = arrival.kind === "seated" || arrival.kind === "no_show" || arrival.kind === "cancelled";
  const refunded = r.refundCents > 0;
  const late = arrival.kind === "late";

  const tableButton = (
    <button
      type="button"
      onClick={onSelectTable}
      aria-pressed={selected}
      aria-label={`Show ${r.tableLabel} on the plan`}
      className="-mx-1 rounded-md px-1 text-left leading-tight text-ink hover:bg-surface-3/60"
    >
      <TableName label={r.tableLabel} className={resolved ? "text-[1.1875rem]" : "text-[1.3125rem]"} />
    </button>
  );

  return (
    <li
      data-row={r.id}
      data-table={r.table}
      data-resolved={resolved || undefined}
      className={cx(
        "relative grid scroll-mt-2 grid-cols-[3.75rem_minmax(0,1fr)] gap-x-4 px-4 transition-colors duration-200 sm:px-5",
        resolved ? "py-3" : "py-4",
        selected ? "bg-surface-2" : "",
      )}
    >
      {selected ? <span aria-hidden className="absolute inset-y-2 left-0 w-[3px] rounded-full bg-accent" /> : null}
      <div className={cx("tabular", resolved ? "pt-0.5 text-ink-3" : "pt-0.5")}>
        <p
          className={cx(
            "leading-none font-semibold",
            resolved ? "text-lg" : "text-[1.4375rem]",
            late ? "text-warning" : resolved ? "text-ink-2" : "text-ink",
          )}
        >
          {time}
        </p>
        <p className="mt-1 text-sm text-ink-3">{meridiem}</p>
      </div>

      {resolved ? (
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-1">
          <div className="min-w-0">
            <p
              className={cx(
                "truncate text-base font-semibold",
                arrival.kind === "cancelled" ? "text-ink-3 line-through decoration-1" : "text-ink-2",
              )}
            >
              {r.guestName}
            </p>
            <p className="flex flex-wrap items-baseline gap-x-2 text-[0.9375rem] text-ink-3">
              {tableButton}
              <span aria-hidden>·</span>
              <span className="tabular">{partyLabel(r.partySize)}</span>
            </p>
          </div>
          <div className="flex items-center gap-1">
            <Status arrival={arrival} seatedLabel={seatedLabel} refunded={refunded} r={r} />
            {!readOnly && arrival.kind !== "cancelled" && !refunded ? (
              <Button
                variant="ghost"
                disabled={pending}
                onClick={onUndo}
                icon={<Undo2 aria-hidden className="size-4" />}
                aria-label={`Undo for ${r.guestName}`}
              >
                Undo
              </Button>
            ) : null}
          </div>
        </div>
      ) : (
        <div className="min-w-0">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate text-lg leading-snug font-semibold text-ink">{r.guestName}</p>
              <p className="mt-0.5 flex flex-wrap items-baseline gap-x-2 text-[0.9375rem] text-ink-2">
                {tableButton}
                <span aria-hidden>·</span>
                <span className="tabular">{partyLabel(r.partySize)}</span>
              </p>
            </div>
            <Badge tone="accent" className="shrink-0">
              Paid {formatMoney(r.priceCents)}
            </Badge>
          </div>
          {occasion || r.note ? (
            <p className="mt-2 flex flex-wrap items-baseline gap-x-2 gap-y-1 text-[0.9375rem] text-ink-2">
              {occasion ? (
                <span className="inline-flex h-7 items-center rounded-full bg-surface-2 px-2.5 text-sm font-medium text-ink-2">
                  {occasion}
                </span>
              ) : null}
              {r.note ? <span className="min-w-0 text-pretty">{r.note}</span> : null}
            </p>
          ) : null}
        </div>
      )}

      {resolved ? null : (
        <div className="col-span-2 mt-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
          <span className="pl-0.5">
            <Status arrival={arrival} seatedLabel={seatedLabel} refunded={refunded} r={r} />
          </span>
          {readOnly ? null : (
            <div className="ml-auto flex items-center gap-2">
              {canMarkNoShow(arrival) ? (
                <Button variant="ghost" disabled={pending} onClick={onNoShow} aria-label={`Mark ${r.guestName} as a no-show`}>
                  No-show
                </Button>
              ) : null}
              <Button
                variant="secondary"
                disabled={pending}
                onClick={onSeatElsewhere}
                icon={<ArrowRightLeft aria-hidden className="size-4" />}
                aria-label={`Seat ${r.guestName} at a different table`}
              >
                Other table
              </Button>
              <Button
                disabled={pending}
                onClick={onSeat}
                icon={<Check aria-hidden className="size-4" strokeWidth={2.25} />}
                aria-label={`Mark ${r.guestName} seated at ${r.tableLabel}`}
                className="min-w-[7.5rem]"
              >
                Seated
              </Button>
            </div>
          )}
        </div>
      )}

      {error ? (
        <p role="alert" className="col-span-2 mt-2 text-[0.9375rem] font-medium text-danger">
          {error}
        </p>
      ) : null}
    </li>
  );
}

function Status({
  arrival,
  seatedLabel,
  refunded,
  r,
}: {
  arrival: Arrival;
  seatedLabel: string | null;
  refunded: boolean;
  r: PortalReservation;
}) {
  const base = "inline-flex items-center gap-1.5 text-[0.9375rem] font-medium tabular";
  switch (arrival.kind) {
    case "seated":
      return (
        <span className={cx(base, "flex-wrap text-success")}>
          <Check aria-hidden className="size-4" strokeWidth={2.25} />
          {seatedLabel ? `At ${seatedLabel}` : "Seated"}
          {seatedLabel && refunded ? (
            <span className="font-normal text-ink-3">· {formatMoney(r.refundCents)} refunded</span>
          ) : null}
        </span>
      );
    case "no_show":
      return (
        <span className={cx(base, "text-danger")}>
          <CircleSlash aria-hidden className="size-4" />
          No-show
        </span>
      );
    case "cancelled":
      return (
        <span className={cx(base, "text-ink-3")}>Cancelled{refunded ? `, ${formatMoney(r.refundCents)} refunded` : ""}</span>
      );
    case "late":
      return (
        <span className={cx(base, "text-warning")}>
          <Clock aria-hidden className="size-4" />
          {arrivalText(arrival)}
        </span>
      );
    case "due":
      return (
        <span className={cx(base, "text-ink")}>
          <Clock aria-hidden className="size-4 text-ink-3" />
          {arrivalText(arrival)}
        </span>
      );
    default:
      return <span className={cx(base, "text-ink-3")}>{arrivalText(arrival)}</span>;
  }
}
