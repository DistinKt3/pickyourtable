import "server-only";
import { Stripe } from "stripe";
import { env } from "@/lib/env";
import { derivedKey } from "@/lib/security/crypto";

/**
 * Webhook signatures use Stripe's own scheme in both modes: Stripe signs real events
 * with STRIPE_WEBHOOK_SECRET, and the simulator signs its events the same way (with
 * that secret if set, else one derived from APP_SECRET). One verification path serves
 * both, so the handler cannot tell them apart.
 */

export function webhookSecret(): string {
  const e = env();
  if (e.STRIPE_WEBHOOK_SECRET) return e.STRIPE_WEBHOOK_SECRET;
  if (e.PAYMENTS_MODE === "stripe") throw new Error("STRIPE_WEBHOOK_SECRET is required in stripe mode");
  return `whsec_${derivedKey("sim-webhook").toString("base64url")}`;
}

/** Parses and verifies a webhook body. Throws when the signature does not match or is stale. */
export function verifyWebhook(payload: string, signature: string): Stripe.Event {
  return Stripe.webhooks.constructEvent(payload, signature, webhookSecret());
}

/** A `stripe-signature` header for a payload, signed now. Used by the simulator and tests. */
export function signWebhook(payload: string, timestamp?: number): string {
  return Stripe.webhooks.generateTestHeaderString({
    payload,
    secret: webhookSecret(),
    ...(timestamp ? { timestamp } : {}),
  });
}
