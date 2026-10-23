import { notFound } from "next/navigation";
import { roomDataFromVenue } from "@/components/room/scene3d/roomData";
import { isVenueId, loadVenue, VenueNotFoundError } from "@/lib/venue/load";
import { DevRoom, type DevRoomFlags } from "./DevRoom";

export const dynamic = "force-dynamic";

export const metadata = { title: "3D room review" };

const codes = (v: string | string[] | undefined) =>
  (Array.isArray(v) ? v.join(",") : (v ?? ""))
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter((s) => /^[A-Z][A-Z0-9]{0,5}$/.test(s));

/**
 * Development-only review page for the 3D room: RoomData from venue.json alone, the
 * scene full screen, and query flags for every state the screenshot loop needs:
 * `?taken=W2,B1&wrong=T1,T3&selected=W1&sit=W1&reduced=1&slot=1&model=dev`.
 */
export default async function DevRoomPage({
  params,
  searchParams,
}: {
  params: Promise<{ venue: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (process.env.NODE_ENV === "production") notFound();
  const { venue: id } = await params;
  const q = await searchParams;
  if (!isVenueId(id)) notFound();
  let venue;
  try {
    venue = await loadVenue(id);
  } catch (e) {
    if (e instanceof VenueNotFoundError) notFound();
    throw e;
  }
  const modelUrl = q.model === "dev" ? `/dev/room/model/${id}` : null;
  const data = roomDataFromVenue(venue, modelUrl);
  const known = new Set(venue.tables.map((t) => t.id));
  const pick = (v: string | string[] | undefined) => codes(v).filter((c) => known.has(c));
  const flags: DevRoomFlags = {
    taken: pick(q.taken),
    wrong: pick(q.wrong),
    selected: pick(q.selected)[0] ?? null,
    sit: pick(q.sit)[0] ?? null,
    reduced: q.reduced === "1",
    slot: q.slot === "1",
  };
  return <DevRoom data={data} flags={flags} />;
}
