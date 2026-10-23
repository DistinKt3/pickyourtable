"use client";

import { CalendarPlus, Trash } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/field";
import { Banner, Dialog } from "@/components/ui/primitives";
import type { PriceRuleView, PricingResponse } from "@/lib/api/contracts";
import { cx, formatDate, formatMoney, formatTime, isoWeekday } from "@/lib/format";
import { PortalError, portalFetch } from "@/lib/portal/client";
import { centsToInput, parseDollars } from "@/lib/portal/money";
import { daysFor, describeDays } from "@/lib/portal/rules";
import { EmptyState, Panel, SectionTitle, TierDot } from "../ui";
import { MoneyInput } from "./money-input";

/**
 * Fees per tier and daypart for weeknights and weekends, edited in dollars and saved
 * as cents, plus special-date overrides. The copy says plainly that a fee change
 * applies to new holds only (PRD O-3).
 */

type DayType = "weeknight" | "weekend";
const DAY_TYPES: DayType[] = ["weeknight", "weekend"];
const key = (tier: string, daypart: string, dayType: string) => `${tier}|${daypart}|${dayType}`;

export function FeesTab({ initial, weekendDays, today }: { initial: PricingResponse; weekendDays: number[]; today: string }) {
  const [rules, setRules] = useState<PriceRuleView[]>(initial.rules);
  const weekly = useMemo(
    () => new Map(rules.filter((r) => r.dayType !== "special").map((r) => [key(r.tier, r.daypart, r.dayType), r])),
    [rules],
  );
  const tiers = initial.tiers.filter((t) => t.bookable || rules.some((r) => r.tier === t.id));
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const [adding, setAdding] = useState(false);

  const value = (k: string) => draft[k] ?? (weekly.get(k) ? centsToInput(weekly.get(k)!.feeCents) : "");
  const changes = Object.entries(draft).filter(([k, v]) => parseDollars(v) !== (weekly.get(k)?.feeCents ?? null));
  const invalid = changes.filter(([, v]) => parseDollars(v) === null);

  async function saveAll() {
    setSaving(true);
    setResult(null);
    let saved = 0;
    try {
      for (const [k, v] of changes) {
        const [tier, daypart, dayType] = k.split("|") as [string, string, DayType];
        const res = await portalFetch<{ rule: PriceRuleView }>("/api/portal/pricing/rules", {
          method: "PUT",
          body: { tier, daypart, dayType, feeCents: parseDollars(v)! },
        });
        setRules((list) => [...list.filter((r) => r.id !== res.rule.id), res.rule]);
        setDraft(({ [k]: _done, ...rest }) => rest);
        saved += 1;
      }
      setResult({ tone: "success", text: `${saved} ${saved === 1 ? "fee" : "fees"} saved. New holds use them from now on.` });
    } catch (e) {
      setResult({
        tone: "danger",
        text: `${saved ? `${saved} saved, then: ` : ""}${e instanceof PortalError ? e.message : "The fees didn't save."}`,
      });
    } finally {
      setSaving(false);
    }
  }

  const specials = useMemo(() => {
    const byDate = new Map<string, PriceRuleView[]>();
    for (const r of rules)
      if (r.dayType === "special" && r.specialDate) byDate.set(r.specialDate, [...(byDate.get(r.specialDate) ?? []), r]);
    return [...byDate.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [rules]);

  async function removeDate(date: string) {
    const list = rules.filter((r) => r.specialDate === date);
    try {
      for (const r of list) {
        await portalFetch(`/api/portal/pricing/rules/${r.id}`, { method: "DELETE" });
        setRules((all) => all.filter((x) => x.id !== r.id));
      }
      setResult({ tone: "success", text: `${formatDate(date, { weekday: "long" })} uses the usual fees again.` });
    } catch (e) {
      setResult({ tone: "danger", text: e instanceof PortalError ? e.message : "That date wasn't removed." });
    }
  }

  const tierName = (id: string) => initial.tiers.find((t) => t.id === id)?.name ?? id;
  const daypartName = (id: string) => initial.dayparts.find((d) => d.id === id)?.name ?? id;

  return (
    <div className="flex flex-col gap-8">
      <Banner tone="neutral" title="Fee changes apply to new holds only">
        Bookings already made keep the price the guest paid. Fees are per table, charged when the guest books.
      </Banner>

      <Panel className="overflow-x-auto">
        <table className="w-full min-w-[34rem] border-separate border-spacing-0 text-left">
          <thead>
            <tr>
              <th
                scope="col"
                rowSpan={2}
                className="border-b border-line px-4 pt-4 pb-3 align-bottom lg:px-5 text-[0.9375rem] font-medium text-ink-3"
              >
                Tier
              </th>
              {initial.dayparts.map((d) => (
                <th
                  key={d.id}
                  scope="colgroup"
                  colSpan={2}
                  className="border-b border-line px-2 pt-4 pb-2 lg:px-3 text-base font-semibold text-ink"
                >
                  {d.name}
                  <span className="block text-[0.9375rem] font-normal text-ink-3 tabular xl:ml-2 xl:inline">
                    {formatTime(d.start)} to {formatTime(d.end)}
                  </span>
                </th>
              ))}
            </tr>
            <tr>
              {initial.dayparts.flatMap((d) =>
                DAY_TYPES.map((dt) => (
                  <th
                    key={`${d.id}-${dt}`}
                    scope="col"
                    className="border-b border-line px-2 pb-3 lg:px-3 align-bottom font-normal"
                  >
                    <span className="block text-[0.9375rem] font-medium text-ink-2">
                      {dt === "weekend" ? "Weekend" : "Weeknight"}
                    </span>
                    <span className="block text-sm text-ink-3">
                      {describeDays(daysFor(d.days, weekendDays, dt)) || "No days"}
                    </span>
                  </th>
                )),
              )}
            </tr>
          </thead>
          <tbody>
            {tiers.map((t) => (
              <tr key={t.id}>
                <th scope="row" className="border-b border-line px-4 py-3 text-base font-medium text-ink lg:px-5">
                  <span className="flex items-center gap-2.5 whitespace-nowrap">
                    <TierDot color={t.color} />
                    {t.name}
                  </span>
                </th>
                {initial.dayparts.flatMap((d) =>
                  DAY_TYPES.map((dt) => {
                    const k = key(t.id, d.id, dt);
                    const v = value(k);
                    const runs = daysFor(d.days, weekendDays, dt).length > 0;
                    const changed = k in draft && parseDollars(draft[k]!) !== (weekly.get(k)?.feeCents ?? null);
                    return (
                      <td key={k} className="border-b border-line px-2 py-3 lg:px-3">
                        {runs ? (
                          <MoneyInput
                            className="w-20 lg:w-28"
                            label={`${t.name}, ${d.name}, ${dt}`}
                            value={v}
                            changed={changed}
                            invalid={changed && parseDollars(v) === null}
                            onChange={(next) => setDraft((x) => ({ ...x, [k]: next }))}
                          />
                        ) : (
                          <span className="block w-20 text-center lg:w-28 text-[0.9375rem] text-ink-3">Closed</span>
                        )}
                      </td>
                    );
                  }),
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>

      {result ? (
        <Banner tone={result.tone} className="-mt-4">
          {result.text}
        </Banner>
      ) : null}

      <section aria-labelledby="special-dates" className="flex flex-col gap-3">
        <SectionTitle
          aside={
            <Button variant="secondary" icon={<CalendarPlus aria-hidden className="size-4" />} onClick={() => setAdding(true)}>
              Add a special date
            </Button>
          }
        >
          <span id="special-dates">Special dates</span>
        </SectionTitle>
        <p className="-mt-1 max-w-3xl text-base text-ink-2">
          On a special date these fees replace the weeknight or weekend fee, for that date only.
        </p>
        <Panel>
          {specials.length === 0 ? (
            <EmptyState icon={<CalendarPlus className="size-5" strokeWidth={1.75} />} title="No special dates">
              Add one for a holiday or an event night.
            </EmptyState>
          ) : (
            <ul className="divide-y divide-line">
              {specials.map(([date, list]) => (
                <li key={date} className="flex flex-wrap items-center justify-between gap-4 px-5 py-4">
                  <div className="min-w-0">
                    <p className="text-lg font-semibold text-ink tabular">{formatDate(date, { weekday: "long", year: true })}</p>
                    <p className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[0.9375rem] text-ink-2 tabular">
                      {list
                        .sort((a, b) => a.tier.localeCompare(b.tier) || a.daypart.localeCompare(b.daypart))
                        .map((r) => (
                          <span key={r.id}>
                            {tierName(r.tier)} {daypartName(r.daypart).toLowerCase()}{" "}
                            <span className="font-semibold text-ink">{formatMoney(r.feeCents)}</span>
                          </span>
                        ))}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    className="ml-auto"
                    icon={<Trash aria-hidden className="size-4" />}
                    onClick={() => void removeDate(date)}
                    aria-label={`Remove special fees on ${formatDate(date, { weekday: "long" })}`}
                  >
                    Remove
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </section>

      {changes.length > 0 ? (
        <div className="sticky bottom-4 z-10">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-card bg-surface-1 px-5 py-3 shadow-pop hairline">
            <p className="text-base text-ink">
              <span className="font-semibold tabular">{changes.length}</span> {changes.length === 1 ? "fee" : "fees"} changed
              <span className="text-ink-3">
                {invalid.length ? " · enter a dollar amount like 25 or 19.50" : " · applies to new holds only"}
              </span>
            </p>
            <div className="ml-auto flex gap-2">
              <Button variant="ghost" onClick={() => setDraft({})} disabled={saving}>
                Discard
              </Button>
              <Button onClick={() => void saveAll()} loading={saving} disabled={invalid.length > 0}>
                Save fees
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {adding ? (
        <SpecialDateDialog
          pricing={{ ...initial, rules }}
          tiers={tiers}
          weekendDays={weekendDays}
          today={today}
          onClose={() => setAdding(false)}
          onSaved={(saved, date) => {
            setRules((list) => [...list.filter((r) => !saved.some((s) => s.id === r.id)), ...saved]);
            setAdding(false);
            setResult({ tone: "success", text: `Special fees saved for ${formatDate(date, { weekday: "long" })}.` });
          }}
        />
      ) : null}
    </div>
  );
}

function SpecialDateDialog({
  pricing,
  tiers,
  weekendDays,
  today,
  onClose,
  onSaved,
}: {
  pricing: PricingResponse;
  tiers: PricingResponse["tiers"];
  weekendDays: number[];
  today: string;
  onClose: () => void;
  onSaved: (rules: PriceRuleView[], date: string) => void;
}) {
  const [date, setDate] = useState("");
  const [fees, setFees] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const valid = /^\d{4}-\d{2}-\d{2}$/.test(date) && date >= today;
  const weekday = valid ? isoWeekday(date) : 0;
  const dayType: DayType = weekendDays.includes(weekday) ? "weekend" : "weeknight";
  const dayparts = valid ? pricing.dayparts.filter((d) => d.days.includes(weekday)) : [];
  const usual = (tier: string, daypart: string) =>
    pricing.rules.find((r) => r.tier === tier && r.daypart === daypart && r.dayType === dayType)?.feeCents ?? 0;
  const existing = (tier: string, daypart: string) =>
    pricing.rules.find((r) => r.tier === tier && r.daypart === daypart && r.dayType === "special" && r.specialDate === date);
  const field = (tier: string, daypart: string) =>
    fees[`${tier}|${daypart}`] ?? centsToInput(existing(tier, daypart)?.feeCents ?? usual(tier, daypart));
  const bad = dayparts.some((d) => tiers.some((t) => parseDollars(field(t.id, d.id)) === null));

  async function save() {
    if (!valid) {
      setError("Choose today or a later date.");
      return;
    }
    setBusy(true);
    setError(null);
    const saved: PriceRuleView[] = [];
    try {
      for (const d of dayparts) {
        for (const t of tiers) {
          const res = await portalFetch<{ rule: PriceRuleView }>("/api/portal/pricing/rules", {
            method: "PUT",
            body: {
              tier: t.id,
              daypart: d.id,
              dayType: "special",
              specialDate: date,
              feeCents: parseDollars(field(t.id, d.id))!,
            },
          });
          saved.push(res.rule);
        }
      }
      onSaved(saved, date);
    } catch (e) {
      setBusy(false);
      if (saved.length) onSaved(saved, date);
      setError(e instanceof PortalError ? e.message : "The special fees didn't save.");
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title="Add a special date"
      className="w-[min(38rem,calc(100vw-2rem))]"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => void save()} loading={busy} disabled={!valid || bad || dayparts.length === 0}>
            Save special fees
          </Button>
        </>
      }
    >
      <TextField
        label="Date"
        type="date"
        min={today}
        value={date}
        onChange={(e) => setDate(e.target.value)}
        error={error}
        className="max-w-xs"
      />
      {valid ? (
        dayparts.length === 0 ? (
          <p className="mt-4 text-base">The venue isn&rsquo;t open for bookings on {formatDate(date, { weekday: "long" })}.</p>
        ) : (
          <div className="mt-5 overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr>
                  <th scope="col" className="pb-2 text-[0.9375rem] font-medium text-ink-3">
                    Tier
                  </th>
                  {dayparts.map((d) => (
                    <th key={d.id} scope="col" className="px-2 pb-2 text-[0.9375rem] font-medium text-ink-2">
                      {d.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {tiers.map((t) => (
                  <tr key={t.id}>
                    <th scope="row" className="py-2 pr-3 text-base font-medium whitespace-nowrap text-ink">
                      <span className="flex items-center gap-2.5">
                        <TierDot color={t.color} />
                        {t.name}
                      </span>
                    </th>
                    {dayparts.map((d) => (
                      <td key={d.id} className="px-2 py-2">
                        <MoneyInput
                          className="w-28"
                          label={`${t.name}, ${d.name}`}
                          value={field(t.id, d.id)}
                          invalid={parseDollars(field(t.id, d.id)) === null}
                          onChange={(v) => setFees((f) => ({ ...f, [`${t.id}|${d.id}`]: v }))}
                        />
                        <span className={cx("mt-1 block text-right text-sm text-ink-3 tabular")}>
                          Usual {formatMoney(usual(t.id, d.id))}
                        </span>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : (
        <p className="mt-4 text-base">Pick the date, then set a fee for each tier. They start from the usual fee for that day.</p>
      )}
    </Dialog>
  );
}
