import { createHoldBody, venueParams } from "@/lib/api/contracts";
import { requireGuestVenue } from "@/lib/booking/context";
import { createHold } from "@/lib/booking/holds";
import { api } from "@/lib/http/api";

/**
 * POST /api/v/{venue}/holds: an 8-minute hold on one table and slot (PRD G-6, S-4).
 * 201 with the hold and its token; 409 `taken` with the most similar free table.
 */
export const POST = api({ guest: true, params: venueParams, body: createHoldBody }, async ({ req, params, body }) => {
  const v = await requireGuestVenue(params.venue);
  return Response.json(await createHold(v, body, req), { status: 201 });
});
