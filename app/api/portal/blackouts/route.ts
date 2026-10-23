import { blackoutsQuery, createBlackoutBody } from "@/lib/api/contracts";
import { todayIn } from "@/lib/format";
import { api } from "@/lib/http/api";
import { createBlackout, listBlackouts } from "@/lib/portal/blackouts";
import { OWNER, portalReader, portalWriter } from "@/lib/portal/guard";
import { loadVenue } from "@/lib/venue/load";

export const dynamic = "force-dynamic";

/** Blackouts from today on (or the given range), in the venue's time zone. Owner only. */
export const GET = api({ query: blackoutsQuery }, async ({ req, query }) => {
  const op = await portalReader(req, OWNER);
  const { timezone } = await loadVenue(op.venueId);
  return { blackouts: await listBlackouts(op.venueId, timezone, { from: query.from ?? todayIn(timezone), to: query.to }) };
});

/**
 * Blocks one table, or every table when `table` is null, for a time range on one date
 * (Owner only). Times are the venue's local times. Confirmed bookings in the range are
 * not cancelled; they come back in `overlapping` so the owner can decide (PRD O-4).
 */
export const POST = api({ body: createBlackoutBody }, async ({ req, body }) => {
  const op = await portalWriter(req, OWNER);
  const { timezone } = await loadVenue(op.venueId);
  return Response.json(await createBlackout(op, timezone, body), { status: 201 });
});
