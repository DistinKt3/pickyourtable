"use client";

import { useEffect, useState } from "react";
import { Segmented } from "@/components/ui/primitives";
import type { PricingResponse, TablesResponse } from "@/lib/api/contracts";
import { PageHeader } from "../ui";
import { FeesTab } from "./fees-tab";
import { TablesTab } from "./tables-tab";
import { TurnTimesTab } from "./turn-times-tab";

/** Tables and pricing (PRD O-3, Owner): tables, fees and turn times on one screen, in tabs. */

type Tab = "tables" | "fees" | "turns";
const TABS: { value: Tab; label: string }[] = [
  { value: "tables", label: "Tables" },
  { value: "fees", label: "Fees" },
  { value: "turns", label: "Turn times" },
];

export function TablesScreen({
  tables,
  pricing,
  initialTab,
  weekendDays,
  maxParty,
  today,
}: {
  tables: TablesResponse;
  pricing: PricingResponse;
  initialTab: Tab;
  weekendDays: number[];
  maxParty: number;
  today: string;
}) {
  const [tab, setTab] = useState<Tab>(initialTab);
  useEffect(() => {
    const url = new URL(window.location.href);
    if (tab === "tables") url.searchParams.delete("tab");
    else url.searchParams.set("tab", tab);
    window.history.replaceState(window.history.state, "", url);
  }, [tab]);

  const pricedTiers = [...new Set(pricing.rules.filter((r) => r.dayType !== "special").map((r) => r.tier))];

  return (
    <div className="pb-12">
      <PageHeader
        title="Tables and pricing"
        eyebrow="Owner settings"
        actions={<Segmented label="Section" value={tab} options={TABS} onChange={setTab} />}
      />
      <div className="px-4 sm:px-6 lg:px-8">
        {tab === "tables" ? <TablesTab initial={tables} pricedTiers={pricedTiers} /> : null}
        {tab === "fees" ? <FeesTab initial={pricing} weekendDays={weekendDays} today={today} /> : null}
        {tab === "turns" ? <TurnTimesTab initial={pricing.turnTimes} maxParty={maxParty} /> : null}
      </div>
    </div>
  );
}
