import { slotsQuery, venueParams } from "@/lib/api/contracts";
import { requireGuestVenue } from "@/lib/booking/context";
import { limitAvailability } from "@/lib/booking/http";
import { slotsForDate } from "@/lib/booking/queries";
import { api } from "@/lib/http/api";

/** GET /api/v/{venue}/slots?date&party: bookable start times with the number of free tables at each. */
export const GET = api({ guest: true, params: venueParams, query: slotsQuery }, async ({ req, params, query }) => {
  await limitAvailability(req);
  const v = await requireGuestVenue(params.venue);
  return slotsForDate(v, query);
});
