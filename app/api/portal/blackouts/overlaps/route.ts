import { api } from "@/lib/http/api";
import { blackoutInstants, overlappingBookings } from "@/lib/portal/blackouts";
import { OWNER, portalReader } from "@/lib/portal/guard";
import { type OverlapsResponse, overlapsQuery } from "@/lib/portal/schemas";
import { loadVenue } from "@/lib/venue/load";

export const dynamic = "force-dynamic";

/** Confirmed bookings a blackout would cover, shown as a warning while the owner fills in the form. */
export const GET = api({ query: overlapsQuery }, async ({ req, query }): Promise<OverlapsResponse> => {
  const op = await portalReader(req, OWNER);
  const { timezone } = await loadVenue(op.venueId);
  const { startsAt, endsAt } = blackoutInstants(query.date, query.from, query.to, timezone);
  return { overlapping: await overlappingBookings(op.venueId, timezone, { table: query.table ?? null, startsAt, endsAt }) };
});
