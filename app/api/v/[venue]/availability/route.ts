import { availabilityQuery, venueParams } from "@/lib/api/contracts";
import { requireGuestVenue } from "@/lib/booking/context";
import { limitAvailability } from "@/lib/booking/http";
import { availability } from "@/lib/booking/queries";
import { api } from "@/lib/http/api";

/** GET /api/v/{venue}/availability?date&time&party: every table's state and fee for one slot (PRD G-2). */
export const GET = api({ guest: true, params: venueParams, query: availabilityQuery }, async ({ req, params, query }) => {
  await limitAvailability(req);
  const v = await requireGuestVenue(params.venue);
  return availability(v, query);
});
