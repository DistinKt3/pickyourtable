import "server-only";
import { eq } from "drizzle-orm";
import type { Stripe } from "stripe";
import { db } from "@/db/client";
import { webhookEvent } from "@/db/schema";
import { log } from "@/lib/log";
import { verifyWebhook } from "@/lib/payments/webhook";
import { confirmPayment, recordPaymentFailure, recordProviderRefund } from "./payment-events";

/**
 * The Stripe webhook (and the simulator's, which signs the same way). Verified by
 * signature, idempotent on the event id, and safe in any order: each event is applied
 * as a guarded state transition, so a replay is a no-op and a late or early event
 * cannot undo a later state.
 */

export interface WebhookResult {
  status: number;
  body: { received: boolean; duplicate?: boolean; outcome?: string; error?: { code: string; message: string } };
}

interface Applied {
  outcome: string;
  reservationId: string | null;
  paymentIntentId: string | null;
  amountCents: number | null;
}

function intentIdOf(v: string | { id: string } | null | undefined): string | null {
  if (!v) return null;
  return typeof v === "string" ? v : v.id;
}

function cardOf(pi: Stripe.PaymentIntent): { brand: string; last4: string } | null {
  const charge = pi.latest_charge;
  if (!charge || typeof charge === "string") return null;
  const card = charge.payment_method_details?.card;
  return card?.last4 ? { brand: card.wallet?.type ?? card.brand ?? "card", last4: card.last4 } : null;
}

async function apply(event: Stripe.Event): Promise<Applied> {
  switch (event.type) {
    case "payment_intent.succeeded": {
      const pi = event.data.object;
      const res = await confirmPayment(pi.id, cardOf(pi), "webhook");
      return { outcome: res.outcome, reservationId: res.reservationId, paymentIntentId: pi.id, amountCents: pi.amount };
    }
    case "payment_intent.payment_failed": {
      const pi = event.data.object;
      const e = pi.last_payment_error;
      const reservationId = await recordPaymentFailure(
        pi.id,
        e ? { code: e.code ?? null, declineCode: e.decline_code ?? null, message: e.message ?? null } : null,
      );
      return {
        outcome: reservationId ? "failure_recorded" : "no_active_hold",
        reservationId,
        paymentIntentId: pi.id,
        amountCents: pi.amount,
      };
    }
    case "charge.refunded": {
      const charge = event.data.object;
      const pi = intentIdOf(charge.payment_intent);
      if (!pi) return { outcome: "ignored", reservationId: null, paymentIntentId: null, amountCents: charge.amount_refunded };
      const latest = charge.refunds?.data?.at(-1)?.id ?? null;
      const reservationId = await recordProviderRefund(pi, charge.amount_refunded, latest);
      return {
        outcome: reservationId ? "refund_recorded" : "unknown_intent",
        reservationId,
        paymentIntentId: pi,
        amountCents: charge.amount_refunded,
      };
    }
    default:
      return { outcome: "ignored", reservationId: null, paymentIntentId: null, amountCents: null };
  }
}

export async function handleStripeWebhook(payload: string, signature: string | null): Promise<WebhookResult> {
  let event: Stripe.Event;
  try {
    if (!signature) throw new Error("missing signature");
    event = verifyWebhook(payload, signature);
  } catch {
    log.warn("webhook.rejected", { outcome: "bad_signature", bytes: payload.length });
    return {
      status: 400,
      body: { received: false, error: { code: "invalid_signature", message: "Webhook signature did not match." } },
    };
  }

  const [fresh] = await db().insert(webhookEvent).values({ id: event.id, type: event.type }).onConflictDoNothing().returning();
  if (!fresh) {
    const [seen] = await db().select().from(webhookEvent).where(eq(webhookEvent.id, event.id));
    if (seen?.processedAt) {
      log.info("webhook.received", { eventId: event.id, type: event.type, outcome: "duplicate" });
      return { status: 200, body: { received: true, duplicate: true } };
    }
    // Seen but not finished (a crash or a concurrent delivery): applying again is safe.
  }

  try {
    const applied = await apply(event);
    await db().update(webhookEvent).set({ processedAt: new Date() }).where(eq(webhookEvent.id, event.id));
    log.info("webhook.received", { eventId: event.id, type: event.type, ...applied });
    return { status: 200, body: { received: true, outcome: applied.outcome } };
  } catch (e) {
    log.error("webhook.failed", { eventId: event.id, type: event.type, outcome: "error", error: e });
    return {
      status: 500,
      body: { received: false, error: { code: "processing_failed", message: "The event could not be processed." } },
    };
  }
}
