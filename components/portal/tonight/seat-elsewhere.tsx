"use client";

import { Check } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Banner, Dialog } from "@/components/ui/primitives";
import type { PortalReservation, TonightResponse } from "@/lib/api/contracts";
import { cx, formatMoney, formatTime } from "@/lib/format";
import { tierOf, type RoomTable } from "@/lib/room/types";
import type { Venue } from "@/lib/venue/schema";
import { surname } from "@/lib/portal/tonight-view";
import { TableName } from "../ui";

/**
 * Seating a guest somewhere other than the table they paid for. The fee is refunded
 * automatically (PRD product decisions), so the dialog says so, with the amount,
 * before the host confirms.
 */
export function SeatElsewhereDialog({
  reservation: r,
  venue,
  tables,
  data,
  now,
  onClose,
  onConfirm,
}: {
  reservation: PortalReservation;
  venue: Venue;
  tables: RoomTable[];
  data: TonightResponse | null;
  now: Date;
  onClose: () => void;
  onConfirm: (table: string) => void;
}) {
  const [choice, setChoice] = useState<string | null>(null);
  const states = useMemo(() => new Map(data?.tables.map((t) => [t.code, t.state]) ?? []), [data]);
  const groups = useMemo(() => {
    const out = new Map<string, RoomTable[]>();
    for (const t of tables) {
      if (t.id === r.table) continue;
      const name = tierOf(venue, t.tier).name;
      out.set(name, [...(out.get(name) ?? []), t]);
    }
    return [...out.entries()];
  }, [tables, venue, r.table]);

  const nextAt = (code: string) =>
    data?.reservations
      .filter((x) => x.id !== r.id && x.table === code && x.status === "confirmed" && new Date(x.slot.endsAt) > now)
      .sort((a, b) => a.slot.startsAt.localeCompare(b.slot.startsAt))[0];

  const chosen = tables.find((t) => t.id === choice);
  const chosenNext = choice ? nextAt(choice) : undefined;
  const refund = r.priceCents - r.refundCents;
  const family = surname(r.guestName);

  return (
    <Dialog
      open
      onClose={onClose}
      title={`Seat ${family} at another table`}
      className="w-[min(44rem,calc(100vw-2rem))]"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Keep {r.tableLabel}
          </Button>
          <Button disabled={!chosen} onClick={() => chosen && onConfirm(chosen.id)}>
            {chosen ? `Seat at ${chosen.label} and refund ${formatMoney(refund)}` : "Choose a table"}
          </Button>
        </>
      }
    >
      <p className="text-base">
        {r.guestName} paid {formatMoney(r.priceCents)} for <span className="font-semibold text-ink">{r.tableLabel}</span>, party
        of {r.partySize}.
      </p>
      <div className="mt-4 max-h-[min(46vh,26rem)] overflow-y-auto rounded-card bg-surface-0 p-3 hairline">
        {groups.map(([tier, list]) => (
          <fieldset key={tier} className="mb-3 last:mb-0">
            <legend className="px-1 pb-2 text-sm font-medium tracking-[0.06em] text-ink-3 uppercase">{tier}</legend>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(10.5rem,1fr))] gap-2">
              {list.map((t) => {
                const state = states.get(t.id) ?? "free";
                const unavailable = state === "seated" || state === "blocked" || state === "held";
                const tooSmall = r.partySize > t.seats;
                const next = nextAt(t.id);
                const selected = choice === t.id;
                const note = unavailable
                  ? state === "seated"
                    ? "Seated now"
                    : state === "blocked"
                      ? "Blocked"
                      : "Held online"
                  : tooSmall
                    ? `Seats ${t.seats}`
                    : next
                      ? `Paid ${formatTime(next.slot.time)}`
                      : "Free";
                return (
                  <button
                    key={t.id}
                    type="button"
                    disabled={unavailable || tooSmall}
                    aria-pressed={selected}
                    onClick={() => setChoice(t.id)}
                    className={cx(
                      "relative flex min-h-16 flex-col items-start justify-center rounded-control px-3 py-2 text-left transition-[background-color,box-shadow] duration-150",
                      selected
                        ? "bg-accent-soft shadow-[inset_0_0_0_2px_var(--accent-base)]"
                        : "bg-surface-1 hairline hover:bg-surface-2 disabled:bg-transparent disabled:opacity-55",
                    )}
                  >
                    <span className="flex w-full items-baseline justify-between gap-2 pr-5">
                      <TableName label={t.label} className="text-[1.1875rem] leading-tight whitespace-nowrap text-ink" />
                      <span className="shrink-0 text-sm text-ink-3 tabular">{t.seats} seats</span>
                    </span>
                    <span
                      className={cx(
                        "text-sm font-medium tabular",
                        next && !unavailable && !tooSmall ? "text-warning" : "text-ink-3",
                      )}
                    >
                      {note}
                    </span>
                    {selected ? (
                      <Check aria-hidden className="absolute top-2 right-2 size-4 text-accent" strokeWidth={2.25} />
                    ) : null}
                  </button>
                );
              })}
            </div>
          </fieldset>
        ))}
      </div>
      {chosen ? (
        <Banner tone="warning" className="mt-4" title={`${formatMoney(refund)} goes back to ${r.guestName}`}>
          Seating them at {chosen.label} instead of {r.tableLabel} refunds their table fee automatically.
          {chosenNext ? ` ${chosen.label} is paid for ${formatTime(chosenNext.slot.time)} by ${chosenNext.guestName}.` : ""}
        </Banner>
      ) : (
        <p className="mt-4 text-[0.9375rem] text-ink-3">
          Their table fee is refunded automatically when they sit somewhere else.
        </p>
      )}
    </Dialog>
  );
}
