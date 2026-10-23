"use client";

import { Pencil } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Banner, Dialog, Switch } from "@/components/ui/primitives";
import type { PortalTable, TablesResponse } from "@/lib/api/contracts";
import { capitalize, cx } from "@/lib/format";
import { PortalError, portalFetch } from "@/lib/portal/client";
import { MAX_ATTRIBUTES } from "@/lib/portal/rules";
import { Panel, TableName, TierDot } from "../ui";

/**
 * Per table: bookable on or off, tier, and up to 3 attributes (PRD O-3). Each change
 * saves at once; the row says when it is saved or why it was refused.
 */

type RowState = { saving: boolean; saved: boolean; error: string | null };

export function TablesTab({ initial, pricedTiers }: { initial: TablesResponse; pricedTiers: string[] }) {
  const [tables, setTables] = useState(initial.tables);
  const [state, setState] = useState<Record<string, RowState>>({});
  const [editing, setEditing] = useState<PortalTable | null>(null);
  const tiers = initial.tiers;
  const priced = new Set(pricedTiers);

  async function save(code: string, changes: Partial<Pick<PortalTable, "bookable" | "tier" | "attributes">>) {
    const before = tables.find((t) => t.code === code)!;
    setTables((list) => list.map((t) => (t.code === code ? { ...t, ...changes } : t)));
    setState((s) => ({ ...s, [code]: { saving: true, saved: false, error: null } }));
    try {
      const res = await portalFetch<{ table: PortalTable }>(`/api/portal/tables/${code}`, { method: "PATCH", body: changes });
      setTables((list) => list.map((t) => (t.code === code ? res.table : t)));
      setState((s) => ({ ...s, [code]: { saving: false, saved: true, error: null } }));
    } catch (e) {
      setTables((list) => list.map((t) => (t.code === code ? before : t)));
      setState((s) => ({
        ...s,
        [code]: { saving: false, saved: false, error: e instanceof PortalError ? e.message : "That didn't save." },
      }));
    }
  }

  const groups = tiers
    .map((tier) => ({ tier, items: tables.filter((t) => t.tier === tier.id) }))
    .filter((g) => g.items.length > 0);

  return (
    <div className="flex flex-col gap-5">
      <p className="max-w-3xl text-base text-ink-2">
        Turning a table off stops new bookings for it; bookings already made stay. Tier and attributes show on the guest&rsquo;s
        table card.
      </p>
      {groups.map(({ tier, items }) => {
        const onCount = items.filter((t) => t.bookable).length;
        return (
          <Panel key={tier.id} aria-label={tier.name} className="overflow-hidden">
            <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line px-5 py-3">
              <h2 className="flex items-center gap-2.5 text-lg font-semibold text-ink">
                <TierDot color={tier.color} />
                {tier.name}
              </h2>
              <p className="text-[0.9375rem] text-ink-3 tabular">
                {items.length} {items.length === 1 ? "table" : "tables"} ·{" "}
                {onCount
                  ? `${onCount} bookable online`
                  : priced.has(tier.id)
                    ? "none bookable online"
                    : "no fees set, seated by the host"}
              </p>
            </header>
            <ul className="divide-y divide-line">
              {items.map((t) => {
                const s = state[t.code];
                const canBook = priced.has(t.tier);
                return (
                  <li
                    key={t.code}
                    className="grid grid-cols-1 gap-x-6 gap-y-2 px-5 py-3.5 md:grid-cols-[9.5rem_minmax(0,1fr)_auto] md:items-center"
                  >
                    <div className="min-w-0">
                      <p className="leading-tight text-ink">
                        <TableName label={t.label} className="text-[1.375rem]" />
                      </p>
                      <p className="mt-0.5 text-[0.9375rem] text-ink-3 tabular">
                        {t.code} · {t.seats} seats
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setEditing(t)}
                      aria-label={`Attributes for ${t.label}: ${t.attributes.join(", ") || "none"}. Edit`}
                      className="group -mx-2 flex min-h-11 min-w-0 items-center gap-2 rounded-control px-2 text-left transition-colors hover:bg-surface-2"
                    >
                      <span className={cx("min-w-0 text-[0.9375rem]", t.attributes.length ? "text-ink-2" : "text-ink-3")}>
                        {t.attributes.length ? t.attributes.map(capitalize).join(" · ") : "No attributes"}
                      </span>
                      <Pencil aria-hidden className="size-4 shrink-0 text-ink-3 group-hover:text-ink" />
                    </button>
                    <div className="flex flex-wrap items-center gap-4 md:justify-end">
                      <label className="relative">
                        <span className="sr-only">Tier for {t.label}</span>
                        <select
                          value={t.tier}
                          onChange={(e) => void save(t.code, { tier: e.target.value })}
                          className="h-11 appearance-none rounded-control bg-surface-1 pr-9 pl-3.5 text-[0.9375rem] font-medium text-ink hairline focus:shadow-[inset_0_0_0_2px_var(--accent-base)] focus:outline-none"
                        >
                          {tiers.map((x) => (
                            <option key={x.id} value={x.id}>
                              {x.name}
                            </option>
                          ))}
                        </select>
                        <svg
                          aria-hidden
                          viewBox="0 0 16 16"
                          className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-ink-3"
                        >
                          <path
                            d="M4 6l4 4 4-4"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="1.5"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      </label>
                      <span className="flex min-h-11 items-center gap-3">
                        <span
                          className={cx("w-16 text-right text-[0.9375rem]", t.bookable ? "font-medium text-ink" : "text-ink-3")}
                        >
                          {t.bookable ? "Bookable" : "Off"}
                        </span>
                        <Switch
                          checked={t.bookable}
                          disabled={!canBook && !t.bookable}
                          label={`${t.label} bookable online`}
                          onChange={(v) => void save(t.code, { bookable: v })}
                        />
                      </span>
                    </div>
                    {s?.error || s?.saving || s?.saved ? (
                      <p
                        role={s.error ? "alert" : "status"}
                        className={cx("text-[0.9375rem] md:col-span-3", s.error ? "font-medium text-danger" : "text-ink-3")}
                      >
                        {s.error ?? (s.saving ? "Saving" : "Saved. New holds use this right away.")}
                      </p>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </Panel>
        );
      })}

      {editing ? (
        <AttributesDialog
          table={editing}
          options={initial.attributes}
          onClose={() => setEditing(null)}
          onSave={(attributes) => {
            const code = editing.code;
            setEditing(null);
            void save(code, { attributes });
          }}
        />
      ) : null}
    </div>
  );
}

function AttributesDialog({
  table,
  options,
  onClose,
  onSave,
}: {
  table: PortalTable;
  options: string[];
  onClose: () => void;
  onSave: (a: string[]) => void;
}) {
  const [chosen, setChosen] = useState<string[]>(table.attributes);
  const full = chosen.length >= MAX_ATTRIBUTES;
  const toggle = (a: string) => setChosen((c) => (c.includes(a) ? c.filter((x) => x !== a) : full ? c : [...c, a]));
  return (
    <Dialog
      open
      onClose={onClose}
      title={`Attributes for ${table.label}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => onSave(chosen)}>Save attributes</Button>
        </>
      }
    >
      <p className="text-base">Choose up to {MAX_ATTRIBUTES}. Guests see them as chips on the table card, in this order.</p>
      <fieldset className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
        <legend className="sr-only">Attributes</legend>
        {options.map((a) => {
          const on = chosen.includes(a);
          const disabled = !on && full;
          return (
            <label
              key={a}
              className={cx(
                "flex min-h-12 cursor-pointer items-center gap-3 rounded-control px-3.5 text-base transition-colors",
                on ? "bg-accent-soft text-ink shadow-[inset_0_0_0_1.5px_var(--accent-base)]" : "bg-surface-1 text-ink-2 hairline",
                disabled && "cursor-not-allowed opacity-50",
              )}
            >
              <input
                type="checkbox"
                checked={on}
                disabled={disabled}
                onChange={() => toggle(a)}
                className="size-5 accent-[var(--accent-base)]"
              />
              {capitalize(a)}
              {on ? <span className="ml-auto text-sm text-ink-3 tabular">{chosen.indexOf(a) + 1}</span> : null}
            </label>
          );
        })}
      </fieldset>
      {full ? (
        <Banner tone="neutral" className="mt-4">
          That&rsquo;s 3. Remove one to choose another.
        </Banner>
      ) : null}
    </Dialog>
  );
}
