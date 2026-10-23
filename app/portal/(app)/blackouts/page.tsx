import type { Metadata } from "next";
import { BlackoutsScreen } from "@/components/portal/blackouts/blackouts-screen";
import { OwnerOnly } from "@/components/portal/ui";
import { todayIn } from "@/lib/format";
import { listBlackouts } from "@/lib/portal/blackouts";
import { portalPage } from "@/lib/portal/page";
import { venueTableRows } from "@/lib/portal/tables";
import { zoneLongName } from "@/lib/portal/time";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Blackouts" };

export default async function BlackoutsPage() {
  const { venue, allowed } = await portalPage(["owner"]);
  if (!allowed) return <OwnerOnly section="Blackouts" />;
  const today = todayIn(venue.timezone);
  const [blackouts, rows] = await Promise.all([
    listBlackouts(venue.id, venue.timezone, { from: today }),
    venueTableRows(venue.id),
  ]);
  const tables = [...rows.filter((r) => r.bookable), ...rows.filter((r) => !r.bookable)].map((r) => ({
    code: r.code,
    label: r.label,
    bookable: r.bookable,
  }));
  return <BlackoutsScreen initial={blackouts} tables={tables} today={today} zoneName={zoneLongName(venue.timezone)} />;
}
