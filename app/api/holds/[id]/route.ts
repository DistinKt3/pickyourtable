import { idParams } from "@/lib/api/contracts";
import { holdStatus, releaseHold, requireHoldToken } from "@/lib/booking/holds";
import { api } from "@/lib/http/api";

/** GET /api/holds/{id} with `Authorization: Bearer <holdToken>`: hold, payment and booking links. */
export const GET = api({ guest: true, params: idParams }, async ({ req, params }) => {
  await requireHoldToken(req, params.id);
  return holdStatus(params.id);
});

/** DELETE /api/holds/{id}: releases the hold and cancels any unpaid PaymentIntent. */
export const DELETE = api({ guest: true, params: idParams }, async ({ req, params }) => {
  await requireHoldToken(req, params.id);
  return releaseHold(params.id);
});
