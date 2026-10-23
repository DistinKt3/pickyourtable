"use client";

import { CalendarDays, Clock, Users } from "lucide-react";
import { Badge, Segmented } from "@/components/ui/primitives";
import { cx, formatDate, formatTime, partyLabel } from "@/lib/format";
import { useRoom } from "@/lib/room/store";
import type { Venue } from "@/lib/venue/schema";

export function WidgetHeader({ venue, onPickSlot, embedded }: { venue: Venue; onPickSlot: () => void; embedded?: boolean }) {
  const view = useRoom((s) => s.view);
  const setView = useRoom((s) => s.setView);
  const slot = useRoom((s) => s.slot);
  const party = useRoom((s) => s.party);

  return (
    <header className="relative z-30 shrink-0 border-b border-line bg-surface-0">
      <div className="flex h-14 items-center justify-between gap-3 px-4 lg:h-16 lg:px-6">
        <div className="flex min-w-0 items-center gap-2.5">
          <h1 className="truncate font-display text-[1.75rem] leading-none lg:text-[2rem]">{venue.name}</h1>
          {venue.demo ? <Badge className="shrink-0">Demo venue</Badge> : null}
        </div>
        <div className="flex items-center gap-2">
          <div className="hidden items-center gap-2 lg:flex">
            <SlotPills slotLabel={slot} party={party} onPick={onPickSlot} />
          </div>
          <Segmented
            label="Show the room or a list"
            value={view}
            onChange={setView}
            options={[
              { value: "room", label: "Room" },
              { value: "list", label: "List" },
            ]}
          />
          {embedded ? <EmbedClose /> : null}
        </div>
      </div>
      <div className="flex gap-2 overflow-x-auto px-4 pb-3 scrollbar-none lg:hidden">
        <SlotPills slotLabel={slot} party={party} onPick={onPickSlot} />
      </div>
    </header>
  );
}

function SlotPills({
  slotLabel,
  party,
  onPick,
}: {
  slotLabel: { date: string; time: string } | null;
  party: number;
  onPick: () => void;
}) {
  const pill =
    "inline-flex h-10 shrink-0 items-center gap-2 rounded-full bg-surface-1 px-3.5 text-[0.9375rem] font-medium text-ink hairline tabular transition-colors duration-150 hover:bg-surface-2";
  return (
    <>
      <button
        type="button"
        className={pill}
        onClick={onPick}
        aria-label={slotLabel ? `Date: ${formatDate(slotLabel.date)}. Change` : "Choose a date"}
      >
        <CalendarDays aria-hidden className="size-4 text-ink-3" strokeWidth={1.75} />
        <span className={cx(!slotLabel && "text-ink-2")}>{slotLabel ? formatDate(slotLabel.date) : "Date"}</span>
      </button>
      <button
        type="button"
        className={pill}
        onClick={onPick}
        aria-label={slotLabel ? `Time: ${formatTime(slotLabel.time)}. Change` : "Choose a time"}
      >
        <Clock aria-hidden className="size-4 text-ink-3" strokeWidth={1.75} />
        <span className={cx(!slotLabel && "text-ink-2")}>{slotLabel ? formatTime(slotLabel.time) : "Time"}</span>
      </button>
      <button type="button" className={pill} onClick={onPick} aria-label={`Party: ${partyLabel(party)}. Change`}>
        <Users aria-hidden className="size-4 text-ink-3" strokeWidth={1.75} />
        <span>{partyLabel(party)}</span>
      </button>
    </>
  );
}

function EmbedClose() {
  return (
    <button
      type="button"
      onClick={() => window.parent.postMessage({ type: "pyt:close" }, "*")}
      className="inline-flex size-10 items-center justify-center rounded-full text-ink-2 hover:bg-surface-2"
      aria-label="Close"
    >
      <svg viewBox="0 0 16 16" aria-hidden className="size-4">
        <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
    </button>
  );
}
