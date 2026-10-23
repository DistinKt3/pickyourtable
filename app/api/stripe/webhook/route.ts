import { handleStripeWebhook } from "@/lib/booking/webhooks";
import { ApiError, api } from "@/lib/http/api";

const MAX_BYTES = 512 * 1024;

/**
 * POST /api/stripe/webhook: Stripe (or the simulator) reports payments and refunds.
 * The raw body is verified against the signature; Stripe posts cross-site, so the
 * same-origin check does not apply, and the kill switch never blocks it.
 */
export const POST = api({ sameOrigin: false }, async ({ req }) => {
  const payload = await req.text();
  if (payload.length > MAX_BYTES) throw new ApiError(413, "too_large", "Request is too large.");
  const res = await handleStripeWebhook(payload, req.headers.get("stripe-signature"));
  return Response.json(res.body, { status: res.status });
});
