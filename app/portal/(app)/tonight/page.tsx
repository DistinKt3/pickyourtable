import type { Metadata } from "next";
import { TonightScreen } from "@/components/portal/tonight/tonight-screen";
import { dateStr, type TonightResponse } from "@/lib/api/contracts";
import { listTonight, OperationError } from "@/lib/booking/operations";
import { todayIn } from "@/lib/format";
import { portalPage } from "@/lib/portal/page";
import { serverNowIso } from "@/lib/portal/time";
import { loadRoomData } from "@/lib/room/load";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Tonight" };

export default async function TonightPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { venue } = await portalPage();
  const today = todayIn(venue.timezone);
  const asked = (await searchParams).date;
  const date = typeof asked === "string" && dateStr.safeParse(asked).success ? asked : today;
  const { data } = await loadRoomData(venue.id);

  // Paint with real bookings when the booking service answers; otherwise the screen
  // loads them itself and explains if it can't.
  let initial: TonightResponse | null = null;
  let initialError: string | null = null;
  try {
    initial = await listTonight({ venueId: venue.id, date });
  } catch (e) {
    if (!(e instanceof OperationError)) throw e;
    initialError = e.message;
  }

  return (
    <TonightScreen
      venue={data.venue}
      venueName={venue.name}
      tables={data.tables}
      today={today}
      initialDate={date}
      initial={initial}
      initialError={initialError}
      serverNow={serverNowIso()}
    />
  );
}
