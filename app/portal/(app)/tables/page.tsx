import type { Metadata } from "next";
import { TablesScreen } from "@/components/portal/tables/tables-screen";
import { OwnerOnly } from "@/components/portal/ui";
import { todayIn } from "@/lib/format";
import { portalPage } from "@/lib/portal/page";
import { getPricing } from "@/lib/portal/pricing";
import { listTables } from "@/lib/portal/tables";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Tables and pricing" };

export default async function TablesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { venue, allowed } = await portalPage(["owner"]);
  if (!allowed) return <OwnerOnly section="Tables and pricing" />;
  const asked = (await searchParams).tab;
  const tab = asked === "fees" || asked === "turns" ? asked : "tables";
  const [tables, pricing] = await Promise.all([listTables(venue.id), getPricing(venue.id)]);
  return (
    <TablesScreen
      tables={tables}
      pricing={pricing}
      initialTab={tab}
      weekendDays={venue.config.booking.weekendDays}
      maxParty={venue.config.booking.maxParty}
      today={todayIn(venue.timezone)}
    />
  );
}
