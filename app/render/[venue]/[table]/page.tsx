import { notFound } from "next/navigation";
import { roomDataFromVenue } from "@/components/room/scene3d/roomData";
import { isVenueId, loadVenue, VenueNotFoundError } from "@/lib/venue/load";
import { SeatRenderClient } from "./SeatRenderClient";

export const dynamic = "force-dynamic";

export const metadata = { title: "Seat view render" };

/**
 * Build-time seat render (PRD "View from the seat"): the view from one table's main
 * seat, no UI. Only for `scripts/render-seat-views.ts`: available in development or
 * when PYT_RENDER_ROUTE=1, never in a normal production deploy. RoomData comes from
 * venue.json alone, no database.
 */
export default async function SeatRenderPage({ params }: { params: Promise<{ venue: string; table: string }> }) {
  if (process.env.PYT_RENDER_ROUTE !== "1" && process.env.NODE_ENV !== "development") notFound();
  const { venue: id, table } = await params;
  if (!isVenueId(id) || !/^[A-Z][A-Z0-9]{0,5}$/.test(table)) notFound();
  let venue;
  try {
    venue = await loadVenue(id);
  } catch (e) {
    if (e instanceof VenueNotFoundError) notFound();
    throw e;
  }
  if (!venue.tables.some((t) => t.id === table)) notFound();
  return <SeatRenderClient data={roomDataFromVenue(venue)} code={table} />;
}
