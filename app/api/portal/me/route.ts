import type { MeResponse } from "@/lib/api/contracts";
import { api } from "@/lib/http/api";
import { portalReader } from "@/lib/portal/guard";
import { portalVenue } from "@/lib/portal/venue";

export const dynamic = "force-dynamic";

/** The signed-in operator and their venue. */
export const GET = api({}, async ({ req }): Promise<MeResponse> => {
  const op = await portalReader(req);
  const venue = await portalVenue(op.venueId);
  return {
    operator: { name: op.name, email: op.email, role: op.role },
    venue: { id: venue.id, name: venue.name, timezone: venue.timezone, live: venue.live },
  };
});
