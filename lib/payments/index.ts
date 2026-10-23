import "server-only";
import { env } from "@/lib/env";
import { createSimProvider } from "./sim";
import { createStripeProvider } from "./stripe";
import type { PaymentsProvider } from "./types";

export type * from "./types";

let cached: { mode: string; provider: PaymentsProvider } | null = null;

/** The payments provider for PAYMENTS_MODE: real Stripe (test mode) or the local simulator. */
export function payments(): PaymentsProvider {
  const mode = env().PAYMENTS_MODE;
  if (cached?.mode === mode) return cached.provider;
  const provider = mode === "stripe" ? createStripeProvider() : createSimProvider();
  cached = { mode, provider };
  return provider;
}
