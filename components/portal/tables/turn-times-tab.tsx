"use client";

import { Plus, X } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Banner } from "@/components/ui/primitives";
import { cx } from "@/lib/format";
import { PortalError, portalFetch } from "@/lib/portal/client";
import { turnTimeProblem, type TurnTimeRange } from "@/lib/portal/rules";
import { Panel } from "../ui";

/**
 * Turn times by party size: how long a table stays booked after the booking time.
 * The same coverage rule runs here and on the server: every party size from 1 to the
 * venue's largest, with no gaps or overlaps.
 */

type Draft = { id: number; minParty: string; maxParty: string; minutes: string };

let nextId = 0;
const toDraft = (t: TurnTimeRange): Draft => ({
  id: (nextId += 1),
  minParty: String(t.minParty),
  maxParty: String(t.maxParty),
  minutes: String(t.minutes),
});
const toRange = (d: Draft): TurnTimeRange => ({
  minParty: Number(d.minParty),
  maxParty: Number(d.maxParty),
  minutes: Number(d.minutes),
});

/** "150" -> "2 h 30 min", shown beside the minutes so a typo stands out. */
function duration(minutes: string): string {
  const m = Number(minutes);
  if (!Number.isFinite(m) || m < 30) return "";
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return h ? `${h} h${rest ? ` ${rest} min` : ""}` : "";
}

export function TurnTimesTab({ initial, maxParty }: { initial: TurnTimeRange[]; maxParty: number }) {
  const [saved, setSaved] = useState(initial);
  const [rows, setRows] = useState<Draft[]>(initial.map(toDraft));
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ tone: "success" | "danger"; text: string } | null>(null);

  const numbersOk = rows.every(
    (r) =>
      [r.minParty, r.maxParty].every((v) => /^\d{1,2}$/.test(v) && Number(v) >= 1 && Number(v) <= 20) &&
      /^\d{2,3}$/.test(r.minutes) &&
      Number(r.minutes) >= 30 &&
      Number(r.minutes) <= 360,
  );
  const problem = numbersOk
    ? turnTimeProblem(rows.map(toRange), maxParty)
    : "Party sizes run from 1 to 20, and turn times from 30 to 360 minutes.";
  const dirty = JSON.stringify(rows.map(toRange)) !== JSON.stringify(saved);

  const set = (i: number, field: keyof Draft, v: string) =>
    setRows((list) => list.map((r, j) => (j === i ? { ...r, [field]: v.replace(/\D/g, "") } : r)));

  async function save() {
    setBusy(true);
    setResult(null);
    try {
      const res = await portalFetch<{ turnTimes: TurnTimeRange[] }>("/api/portal/turn-times", {
        method: "PUT",
        body: { turnTimes: rows.map(toRange) },
      });
      setSaved(res.turnTimes);
      setRows(res.turnTimes.map(toDraft));
      setResult({ tone: "success", text: "Turn times saved. New bookings use them from now on." });
    } catch (e) {
      setResult({ tone: "danger", text: e instanceof PortalError ? e.message : "The turn times didn't save." });
    } finally {
      setBusy(false);
    }
  }

  const input =
    "h-11 w-16 rounded-control bg-surface-1 text-center text-base font-medium text-ink tabular hairline focus:shadow-[inset_0_0_0_2px_var(--accent-base)] focus:outline-none";

  return (
    <div className="flex max-w-3xl flex-col gap-5">
      <p className="text-base text-ink-2">
        How long a table stays booked after the booking time. Every party size from 1 to {maxParty} needs a turn time. Changes
        apply to new bookings.
      </p>
      <Panel>
        <ul className="divide-y divide-line">
          {rows.map((r, i) => (
            <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-5 py-3 text-base text-ink-2">
              <span className="w-20">Parties of</span>
              <input
                aria-label={`Range ${i + 1}, smallest party`}
                inputMode="numeric"
                className={input}
                value={r.minParty}
                onChange={(e) => set(i, "minParty", e.target.value)}
              />
              <span>to</span>
              <input
                aria-label={`Range ${i + 1}, largest party`}
                inputMode="numeric"
                className={input}
                value={r.maxParty}
                onChange={(e) => set(i, "maxParty", e.target.value)}
              />
              <span>keep the table for</span>
              <input
                aria-label={`Range ${i + 1}, minutes`}
                inputMode="numeric"
                className={cx(input, "w-20")}
                value={r.minutes}
                onChange={(e) => set(i, "minutes", e.target.value)}
              />
              <span>minutes</span>
              <span className="text-[0.9375rem] text-ink-3 tabular">{duration(r.minutes)}</span>
              <span className="ml-auto">
                <button
                  type="button"
                  disabled={rows.length === 1}
                  onClick={() => setRows((list) => list.filter((_, j) => j !== i))}
                  aria-label={`Remove range ${i + 1}`}
                  className="inline-flex size-11 items-center justify-center rounded-full text-ink-3 transition-colors hover:bg-surface-2 hover:text-ink disabled:opacity-40"
                >
                  <X aria-hidden className="size-4" />
                </button>
              </span>
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-5 py-3">
          <Button
            variant="ghost"
            icon={<Plus aria-hidden className="size-4" />}
            disabled={rows.length >= 10}
            onClick={() => {
              const last = rows.at(-1);
              const from = last ? Number(last.maxParty) + 1 : 1;
              setRows((list) => [...list, toDraft({ minParty: from, maxParty: Math.max(from, maxParty), minutes: 120 })]);
            }}
          >
            Add a range
          </Button>
          <div className="flex gap-2">
            {dirty ? (
              <Button variant="ghost" onClick={() => setRows(saved.map(toDraft))} disabled={busy}>
                Discard
              </Button>
            ) : null}
            <Button onClick={() => void save()} loading={busy} disabled={!dirty || Boolean(problem)}>
              Save turn times
            </Button>
          </div>
        </div>
      </Panel>
      {problem && dirty ? <Banner tone="warning">{problem}</Banner> : null}
      {result ? <Banner tone={result.tone}>{result.text}</Banner> : null}
    </div>
  );
}
