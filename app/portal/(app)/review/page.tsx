import { existsSync } from "node:fs";
import path from "node:path";
import type { Metadata } from "next";
import { ReviewScreen } from "@/components/portal/review/review-screen";
import { OwnerOnly } from "@/components/portal/ui";
import { todayIn } from "@/lib/format";
import { portalPage } from "@/lib/portal/page";
import { getReview } from "@/lib/portal/review";
import { utcToLocal } from "@/lib/portal/time";
import { loadRoomData } from "@/lib/room/load";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Venue review" };

export default async function ReviewPage() {
  const { venue, allowed } = await portalPage(["owner"]);
  if (!allowed) return <OwnerOnly section="Venue review" />;
  const [review, room] = await Promise.all([getReview(venue.id), loadRoomData(venue.id)]);
  return (
    <ReviewScreen
      venue={room.data.venue}
      venueName={venue.name}
      tables={room.data.tables}
      initial={review}
      liveSinceDate={venue.wentLiveAt ? utcToLocal(venue.wentLiveAt, venue.timezone).date : null}
      today={todayIn(venue.timezone)}
      withoutImage={review.tables
        .filter((t) => !existsSync(path.join(process.cwd(), "public", t.image.fallback)))
        .map((t) => t.code)}
    />
  );
}
