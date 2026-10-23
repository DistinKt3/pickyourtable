import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { CSSProperties } from "react";
import { GuestWidget } from "@/components/booking/widget";
import { isWidgetEnabled } from "@/lib/flags";
import { todayIn } from "@/lib/format";
import { loadRoomData } from "@/lib/room/load";
import { WidgetPaused } from "@/components/booking/paused";
import { env } from "@/lib/env";
import { isVenueId, VenueNotFoundError } from "@/lib/venue/load";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ venue: string }>; searchParams: Promise<{ embed?: string }> };

async function load(id: string) {
  if (!isVenueId(id)) notFound();
  try {
    return await loadRoomData(id);
  } catch (e) {
    if (e instanceof VenueNotFoundError) notFound();
    throw e;
  }
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { venue } = await params;
  if (!isVenueId(venue)) return {};
  try {
    const { data } = await loadRoomData(venue);
    return {
      title: `${data.venue.name}: choose your table`,
      description: `See the room and the view from your seat before you book at ${data.venue.name}.`,
    };
  } catch {
    return {};
  }
}

export default async function VenuePage({ params, searchParams }: Params) {
  const { venue: id } = await params;
  const { embed } = await searchParams;
  const { data, live } = await load(id);
  const v = data.venue;
  const theme = {
    "--accent": v.brand.accent,
    "--accent-dark": v.brand.accentDark,
    "--on-accent": v.brand.onAccent,
  } as CSSProperties;

  if (!(await isWidgetEnabled()) || !live) {
    return (
      <div style={theme}>
        <WidgetPaused venue={v} reason={live ? "paused" : "not_live"} />
      </div>
    );
  }

  return (
    <div style={theme} className="contents">
      <GuestWidget
        data={data}
        today={todayIn(v.timezone)}
        turnstileSiteKey={env().TURNSTILE_SITE_KEY}
        turnstileMode={env().TURNSTILE_MODE}
        embedded={embed === "1"}
      />
    </div>
  );
}
