import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { CSSProperties } from "react";
import { ManageBooking } from "@/components/booking/manage";
import { loadRoomData } from "@/lib/room/load";
import { isVenueId, VenueNotFoundError } from "@/lib/venue/load";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Your booking", referrer: "no-referrer" };

type Params = { params: Promise<{ venue: string; token: string }> };

/** The guest's manage link (PRD guest step 8): view or cancel, no account. */
export default async function ManagePage({ params }: Params) {
  const { venue: id, token } = await params;
  if (!isVenueId(id) || token.length > 1024) notFound();
  let data;
  try {
    ({ data } = await loadRoomData(id));
  } catch (e) {
    if (e instanceof VenueNotFoundError) notFound();
    throw e;
  }
  const v = data.venue;
  const theme = {
    "--accent": v.brand.accent,
    "--accent-dark": v.brand.accentDark,
    "--on-accent": v.brand.onAccent,
  } as CSSProperties;
  return (
    <div style={theme} data-pyt-root className="min-h-dvh bg-surface-0">
      <ManageBooking data={data} token={token} />
    </div>
  );
}
