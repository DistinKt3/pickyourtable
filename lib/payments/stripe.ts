import "server-only";
import { Stripe } from "stripe";
import { env } from "@/lib/env";
import type {
  CancelResult,
  CreateIntentInput,
  IntentStatus,
  PaymentIntentInfo,
  PaymentsProvider,
  RefundInfo,
  RefundInput,
} from "./types";

/**
 * Stripe Connect in test mode (env.ts refuses live keys). Destination charges: the
 * guest pays the platform, the venue's connected account receives the transfer, and
 * the platform keeps `application_fee_amount`. Refunds reverse the transfer and the
 * application fee, so the venue and the platform each give back their share.
 */

/** The API version this SDK release ships as its latest; pinned so Stripe never changes shapes under us. */
export const STRIPE_API_VERSION = "2026-09-30.endive" as const;

let client: Stripe | null = null;

export function stripeClient(): Stripe {
  if (client) return client;
  const key = env().STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY is not set");
  client = new Stripe(key, {
    apiVersion: STRIPE_API_VERSION,
    telemetry: false,
    maxNetworkRetries: 2,
    typescript: true,
    appInfo: { name: "table-booking" },
  });
  return client;
}

function cardOf(charge: Stripe.Charge | string | null): PaymentIntentInfo["card"] {
  if (!charge || typeof charge === "string") return null;
  const card = charge.payment_method_details?.card;
  if (!card?.last4) return null;
  return { brand: card.wallet?.type ?? card.brand ?? "card", last4: card.last4 };
}

export function intentInfo(pi: Stripe.PaymentIntent): PaymentIntentInfo {
  const charge = typeof pi.latest_charge === "object" ? pi.latest_charge : null;
  const destination = pi.transfer_data?.destination;
  return {
    id: pi.id,
    clientSecret: pi.client_secret,
    amount: pi.amount,
    amountReceived: pi.amount_received,
    amountRefunded: charge?.amount_refunded ?? 0,
    currency: pi.currency,
    status: pi.status as IntentStatus,
    applicationFeeAmount: pi.application_fee_amount,
    destination: typeof destination === "string" ? destination : (destination?.id ?? null),
    metadata: { ...pi.metadata },
    card: cardOf(pi.latest_charge),
    lastError: pi.last_payment_error
      ? {
          code: pi.last_payment_error.code ?? null,
          declineCode: pi.last_payment_error.decline_code ?? null,
          message: pi.last_payment_error.message ?? null,
        }
      : null,
  };
}

function refundInfo(r: Stripe.Refund): RefundInfo {
  const pi = typeof r.payment_intent === "string" ? r.payment_intent : (r.payment_intent?.id ?? "");
  return { id: r.id, paymentIntentId: pi, amount: r.amount, status: (r.status ?? "pending") as RefundInfo["status"] };
}

export function createStripeProvider(): PaymentsProvider {
  const publishableKey = env().STRIPE_PUBLISHABLE_KEY ?? null;
  return {
    mode: "stripe",
    publishableKey,

    async createPaymentIntent(input: CreateIntentInput) {
      const pi = await stripeClient().paymentIntents.create(
        {
          amount: input.amount,
          currency: input.currency,
          automatic_payment_methods: { enabled: true },
          transfer_data: { destination: input.destination },
          application_fee_amount: input.applicationFeeAmount,
          metadata: input.metadata,
          receipt_email: input.receiptEmail,
          description: input.description,
        },
        { idempotencyKey: input.idempotencyKey },
      );
      return intentInfo(pi);
    },

    async retrievePaymentIntent(id: string) {
      return intentInfo(await stripeClient().paymentIntents.retrieve(id, { expand: ["latest_charge"] }));
    },

    async updateReceiptEmail(id: string, email: string) {
      await stripeClient().paymentIntents.update(id, { receipt_email: email });
    },

    async cancelPaymentIntent(id: string): Promise<CancelResult> {
      try {
        const pi = await stripeClient().paymentIntents.cancel(id);
        return { canceled: true, intent: intentInfo(pi) };
      } catch (e) {
        if (e instanceof Stripe.errors.StripeInvalidRequestError && e.code === "payment_intent_unexpected_state") {
          const pi = await stripeClient().paymentIntents.retrieve(id, { expand: ["latest_charge"] });
          return { canceled: pi.status === "canceled", intent: intentInfo(pi) };
        }
        throw e;
      }
    },

    async refund(input: RefundInput) {
      const r = await stripeClient().refunds.create(
        {
          payment_intent: input.paymentIntentId,
          amount: input.amount,
          reverse_transfer: true,
          refund_application_fee: true,
          ...(input.reason ? { reason: input.reason } : {}),
          metadata: input.metadata,
        },
        { idempotencyKey: input.idempotencyKey },
      );
      return refundInfo(r);
    },

    async listRefunds(paymentIntentId: string) {
      const page = await stripeClient().refunds.list({ payment_intent: paymentIntentId, limit: 100 });
      return page.data.map(refundInfo);
    },
  };
}
