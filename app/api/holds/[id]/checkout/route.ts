import { checkoutBody, idParams } from "@/lib/api/contracts";
import { checkout } from "@/lib/booking/checkout";
import { requireHoldToken } from "@/lib/booking/holds";
import { api } from "@/lib/http/api";

/**
 * POST /api/holds/{id}/checkout with the hold token: saves the guest's details and
 * returns the PaymentIntent for the hold's server price (PRD G-7, S-1).
 */
export const POST = api({ guest: true, params: idParams, body: checkoutBody }, async ({ req, params, body }) => {
  await requireHoldToken(req, params.id);
  return checkout(params.id, body.guest);
});
