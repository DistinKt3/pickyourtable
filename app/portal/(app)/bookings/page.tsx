import type { Metadata } from "next";
import { BookingsScreen } from "@/components/portal/bookings/bookings-screen";
import type { BookingsResponse } from "@/lib/api/contracts";
import { listBookings, OperationError } from "@/lib/booking/operations";
import { todayIn } from "@/lib/format";
import { portalPage } from "@/lib/portal/page";
import { venueTableRows } from "@/lib/portal/tables";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Bookings" };

export default async function BookingsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { op, venue } = await portalPage();
  const asked = (await searchParams).q;
  const q = typeof asked === "string" ? asked.slice(0, 80) : "";
  const tables = await venueTableRows(venue.id);

  let initial: BookingsResponse | null = null;
  let initialError: string | null = null;
  if (!q) {
    try {
      initial = await listBookings({ venueId: venue.id, status: "upcoming" });
    } catch (e) {
      if (!(e instanceof OperationError)) throw e;
      initialError = e.message;
    }
  }

  return (
    <BookingsScreen
      initial={initial}
      initialError={initialError}
      initialQuery={q}
      isOwner={op.role === "owner"}
      today={todayIn(venue.timezone)}
      timezone={venue.timezone}
      labels={Object.fromEntries(tables.map((t) => [t.code, t.label]))}
    />
  );
}
