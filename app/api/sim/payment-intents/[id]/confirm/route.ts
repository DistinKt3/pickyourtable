import { z } from "zod";
import { simConfirmBody } from "@/lib/api/contracts";
import { env } from "@/lib/env";
import { ApiError, api } from "@/lib/http/api";
import { confirmSimIntent, SimRequestError } from "@/lib/payments/sim";

const params = z.object({ id: z.string().regex(/^pi_sim_[a-f0-9]{24}$/) });

/**
 * POST /api/sim/payment-intents/{id}/confirm: the simulator's stand-in for Stripe.js
 * confirmPayment. Exists only in sim mode. The client sends an outcome, a brand and
 * the last 4 digits; never a card number.
 */
export const POST = api({ params, body: simConfirmBody }, async ({ params: p, body }) => {
  if (env().PAYMENTS_MODE !== "sim") throw new ApiError(404, "not_found", "Not found.");
  try {
    return await confirmSimIntent(p.id, body);
  } catch (e) {
    if (e instanceof SimRequestError) throw new ApiError(e.status, e.code, e.message);
    throw e;
  }
});
