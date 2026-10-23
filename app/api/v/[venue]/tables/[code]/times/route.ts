import { tableTimesQuery, venueTableParams } from "@/lib/api/contracts";
import { requireGuestVenue } from "@/lib/booking/context";
import { limitAvailability } from "@/lib/booking/http";
import { timesForTable } from "@/lib/booking/queries";
import { api } from "@/lib/http/api";

/** GET /api/v/{venue}/tables/{code}/times: the next free slots for one table (PRD G-11). */
export const GET = api({ guest: true, params: venueTableParams, query: tableTimesQuery }, async ({ req, params, query }) => {
  await limitAvailability(req);
  const v = await requireGuestVenue(params.venue);
  return timesForTable(v, { code: params.code, ...query });
});
