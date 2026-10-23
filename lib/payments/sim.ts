import "server-only";
import { randomBytes } from "node:crypto";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { after } from "next/server";
import { db } from "@/db/client";
import { simEvent, simPaymentIntent, simRefund } from "@/db/schema";
import { env } from "@/lib/env";
import { log } from "@/lib/log";
import { randomToken, safeEqual } from "@/lib/security/crypto";
import { STRIPE_API_VERSION } from "./stripe";
import type {
  CancelResult,
  CreateIntentInput,
  IntentStatus,
  PaymentIntentInfo,
  PaymentsProvider,
  RefundInfo,
  RefundInput,
} from "./types";
import { signWebhook } from "./webhook";

/**
 * A faithful local stand-in for Stripe (PAYMENTS_MODE=sim), for machines without Stripe
 * keys. PaymentIntents, refunds and events live in the sim_* tables with Stripe's ids,
 * states and object shapes. Events are signed with Stripe's scheme and delivered to the
 * app's own webhook endpoint, so the webhook handler is the same code in both modes.
 *
 * Delivery (SIM_WEBHOOK_DELIVERY):
 * - async (default): POST to APP_URL/api/stripe/webhook after the response, one retry.
 * - inline: call the webhook handler in process before returning (tests).
 * - manual: record only; tests deliver, replay and reorder events themselves.
 */

type Delivery = "async" | "inline" | "manual";

export function simDelivery(): Delivery {
  const v = process.env.SIM_WEBHOOK_DELIVERY;
  return v === "inline" || v === "manual" ? v : "async";
}

const hex = (bytes: number) => randomBytes(bytes).toString("hex");

type SimIntentRow = typeof simPaymentIntent.$inferSelect;
type SimRefundRow = typeof simRefund.$inferSelect;

interface StripeLikeError {
  type: "card_error" | "api_error";
  code: string;
  decline_code?: string;
  message: string;
}

const WALLETS = new Set(["apple_pay", "google_pay"]);

function chargeId(intentId: string): string {
  return intentId.replace(/^pi_/, "ch_");
}

function refundObject(r: SimRefundRow) {
  return {
    id: r.id,
    object: "refund",
    amount: r.amount,
    currency: "usd",
    payment_intent: r.paymentIntentId,
    charge: chargeId(r.paymentIntentId),
    status: r.status,
    reason: r.reason,
    metadata: r.metadata,
    created: Math.floor(r.createdAt.getTime() / 1000),
  };
}

function chargeObject(pi: SimIntentRow, refunds: SimRefundRow[]) {
  const refunded = refunds.filter((r) => r.status === "succeeded").reduce((s, r) => s + r.amount, 0);
  const brand = pi.cardBrand ?? "visa";
  return {
    id: chargeId(pi.id),
    object: "charge",
    amount: pi.amount,
    amount_captured: pi.amount,
    amount_refunded: refunded,
    application_fee_amount: pi.applicationFeeAmount,
    currency: pi.currency,
    paid: true,
    captured: true,
    refunded: refunded >= pi.amount,
    status: "succeeded",
    payment_intent: pi.id,
    metadata: pi.metadata,
    transfer_data: { destination: pi.destination },
    payment_method_details: {
      type: "card",
      card: {
        brand: WALLETS.has(brand) ? "visa" : brand,
        last4: pi.cardLast4,
        wallet: WALLETS.has(brand) ? { type: brand } : null,
      },
    },
    refunds: { object: "list", data: refunds.map(refundObject), has_more: false },
    created: Math.floor(pi.updatedAt.getTime() / 1000),
  };
}

function intentObject(pi: SimIntentRow, refunds: SimRefundRow[]) {
  const succeeded = pi.status === "succeeded";
  return {
    id: pi.id,
    object: "payment_intent",
    amount: pi.amount,
    amount_capturable: 0,
    amount_received: succeeded ? pi.amount : 0,
    application_fee_amount: pi.applicationFeeAmount,
    automatic_payment_methods: { enabled: true },
    client_secret: pi.clientSecret,
    created: Math.floor(pi.createdAt.getTime() / 1000),
    currency: pi.currency,
    last_payment_error: pi.lastError,
    latest_charge: succeeded ? chargeObject(pi, refunds) : null,
    livemode: false,
    metadata: pi.metadata,
    status: pi.status,
    transfer_data: { destination: pi.destination },
  };
}

function info(pi: SimIntentRow, refunds: SimRefundRow[]): PaymentIntentInfo {
  const refunded = refunds.filter((r) => r.status === "succeeded").reduce((s, r) => s + r.amount, 0);
  const err = pi.lastError as StripeLikeError | null;
  return {
    id: pi.id,
    clientSecret: pi.clientSecret,
    amount: pi.amount,
    amountReceived: pi.status === "succeeded" ? pi.amount : 0,
    amountRefunded: refunded,
    currency: pi.currency,
    status: pi.status as IntentStatus,
    applicationFeeAmount: pi.applicationFeeAmount,
    destination: pi.destination,
    metadata: pi.metadata as Record<string, string>,
    card: pi.status === "succeeded" && pi.cardBrand && pi.cardLast4 ? { brand: pi.cardBrand, last4: pi.cardLast4 } : null,
    lastError: err ? { code: err.code, declineCode: err.decline_code ?? null, message: err.message } : null,
  };
}

async function load(id: string): Promise<{ pi: SimIntentRow; refunds: SimRefundRow[] } | null> {
  const [pi] = await db().select().from(simPaymentIntent).where(eq(simPaymentIntent.id, id));
  if (!pi) return null;
  const refunds = await db().select().from(simRefund).where(eq(simRefund.paymentIntentId, id)).orderBy(asc(simRefund.createdAt));
  return { pi, refunds };
}

async function loadOrThrow(id: string) {
  const found = await load(id);
  if (!found) throw new SimRequestError(404, "resource_missing", `No such payment_intent: '${id}'`);
  return found;
}

export class SimRequestError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/* ------------------------------------------------------------------ Events */

export type SimEventRow = typeof simEvent.$inferSelect;

async function emit(type: string, object: unknown): Promise<SimEventRow> {
  const event = {
    id: `evt_sim_${hex(12)}`,
    object: "event",
    api_version: STRIPE_API_VERSION,
    created: Math.floor(Date.now() / 1000),
    livemode: false,
    pending_webhooks: 1,
    request: { id: null, idempotency_key: null },
    type,
    data: { object },
  };
  const [row] = await db().insert(simEvent).values({ id: event.id, type, payload: event }).returning();
  const mode = simDelivery();
  if (mode === "inline") await deliverInline(row!);
  else if (mode === "async") deliverLater(row!);
  return row!;
}

async function markDelivered(id: string) {
  await db().update(simEvent).set({ deliveredAt: new Date() }).where(eq(simEvent.id, id));
}

/**
 * Calls the webhook handler in this process with a freshly signed copy of the event.
 * The handler is loaded late, so the simulator does not depend on the booking code
 * when it loads.
 */
async function deliverInline(row: SimEventRow): Promise<{ status: number; body: unknown }> {
  const payload = JSON.stringify(row.payload);
  const { handleStripeWebhook } = await import("@/lib/booking/webhooks");
  const result = await handleStripeWebhook(payload, signWebhook(payload));
  if (result.status < 300) await markDelivered(row.id);
  return result;
}

async function postEvent(row: SimEventRow): Promise<boolean> {
  const payload = JSON.stringify(row.payload);
  try {
    const res = await fetch(new URL("/api/stripe/webhook", env().APP_URL), {
      method: "POST",
      headers: { "content-type": "application/json", "stripe-signature": signWebhook(payload) },
      body: payload,
      signal: AbortSignal.timeout(10_000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

function deliverLater(row: SimEventRow) {
  const task = async () => {
    for (let attempt = 1; attempt <= 2; attempt++) {
      if (await postEvent(row)) {
        await markDelivered(row.id);
        return;
      }
      if (attempt === 1) await new Promise((r) => setTimeout(r, 1000));
    }
    log.warn("sim.webhook_undelivered", { eventId: row.id, type: row.type });
  };
  try {
    // Inside a request, run after the response is sent, like Stripe's own delivery.
    after(task);
  } catch {
    void task().catch((e: unknown) => log.error("sim.webhook_failed", { eventId: row.id, error: e }));
  }
}

/** Recorded events, oldest first. For tests and the dev tools. */
export async function listSimEvents(filter: { paymentIntentId?: string; types?: string[] } = {}): Promise<SimEventRow[]> {
  const conds = [];
  if (filter.types?.length) conds.push(inArray(simEvent.type, filter.types));
  if (filter.paymentIntentId) {
    conds.push(
      sql`(${simEvent.payload} -> 'data' -> 'object' ->> 'id' = ${filter.paymentIntentId} OR ${simEvent.payload} -> 'data' -> 'object' ->> 'payment_intent' = ${filter.paymentIntentId})`,
    );
  }
  return db()
    .select()
    .from(simEvent)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(asc(simEvent.createdAt), asc(simEvent.id));
}

/** Delivers (or redelivers) one recorded event to the webhook handler, signed now. */
export async function deliverSimEvent(eventId: string): Promise<{ status: number; body: unknown }> {
  const [row] = await db().select().from(simEvent).where(eq(simEvent.id, eventId));
  if (!row) throw new Error(`no sim event ${eventId}`);
  return deliverInline(row);
}

/* ---------------------------------------------------------------- Provider */

export function createSimProvider(): PaymentsProvider {
  return {
    mode: "sim",
    publishableKey: null,

    async createPaymentIntent(input: CreateIntentInput) {
      const id = `pi_sim_${hex(12)}`;
      await db()
        .insert(simPaymentIntent)
        .values({
          id,
          clientSecret: `${id}_secret_${randomToken(18).replace(/[-_]/g, "x")}`,
          amount: input.amount,
          currency: input.currency,
          status: "requires_payment_method",
          applicationFeeAmount: input.applicationFeeAmount,
          destination: input.destination,
          metadata: input.metadata,
          idempotencyKey: input.idempotencyKey,
        })
        .onConflictDoNothing({ target: simPaymentIntent.idempotencyKey });
      // Same idempotency key: Stripe returns the first intent, and refuses different parameters.
      const [row] = await db().select().from(simPaymentIntent).where(eq(simPaymentIntent.idempotencyKey, input.idempotencyKey));
      if (!row) throw new Error("sim payment intent was not stored");
      if (row.amount !== input.amount || row.applicationFeeAmount !== input.applicationFeeAmount) {
        throw new SimRequestError(
          400,
          "idempotency_error",
          "Keys for idempotent requests can only be used with the same parameters.",
        );
      }
      await emit("payment_intent.created", intentObject(row, []));
      return info(row, []);
    },

    async retrievePaymentIntent(id: string) {
      const { pi, refunds } = await loadOrThrow(id);
      return info(pi, refunds);
    },

    async updateReceiptEmail(id: string) {
      // The simulator keeps no guest contact details; receipts are Stripe's job.
      await loadOrThrow(id);
    },

    async cancelPaymentIntent(id: string): Promise<CancelResult> {
      const updated = await db()
        .update(simPaymentIntent)
        .set({ status: "canceled", updatedAt: new Date() })
        .where(
          and(
            eq(simPaymentIntent.id, id),
            inArray(simPaymentIntent.status, ["requires_payment_method", "requires_confirmation", "requires_action"]),
          ),
        )
        .returning();
      const { pi, refunds } = await loadOrThrow(id);
      if (updated.length) await emit("payment_intent.canceled", intentObject(pi, refunds));
      return { canceled: pi.status === "canceled", intent: info(pi, refunds) };
    },

    async refund(input: RefundInput): Promise<RefundInfo> {
      const [existing] = await db().select().from(simRefund).where(eq(simRefund.idempotencyKey, input.idempotencyKey));
      if (existing) {
        if (existing.paymentIntentId !== input.paymentIntentId || existing.amount !== input.amount) {
          throw new SimRequestError(
            400,
            "idempotency_error",
            "Keys for idempotent requests can only be used with the same parameters.",
          );
        }
        return { id: existing.id, paymentIntentId: existing.paymentIntentId, amount: existing.amount, status: "succeeded" };
      }
      const { pi, refunds } = await loadOrThrow(input.paymentIntentId);
      if (pi.status !== "succeeded") {
        throw new SimRequestError(400, "charge_not_succeeded", "This PaymentIntent does not have a successful charge to refund.");
      }
      const refunded = refunds.reduce((s, r) => s + r.amount, 0);
      if (input.amount <= 0 || refunded + input.amount > pi.amount) {
        throw new SimRequestError(400, "amount_too_large", "Refund amount is greater than the unrefunded amount on the charge.");
      }
      const [row] = await db()
        .insert(simRefund)
        .values({
          id: `re_sim_${hex(12)}`,
          paymentIntentId: pi.id,
          amount: input.amount,
          status: "succeeded",
          reason: input.reason ?? null,
          metadata: input.metadata,
          idempotencyKey: input.idempotencyKey,
        })
        .onConflictDoNothing({ target: simRefund.idempotencyKey })
        .returning();
      if (!row) {
        // A concurrent request with the same key won; return its refund.
        const [won] = await db().select().from(simRefund).where(eq(simRefund.idempotencyKey, input.idempotencyKey));
        return { id: won!.id, paymentIntentId: won!.paymentIntentId, amount: won!.amount, status: "succeeded" };
      }
      await emit("charge.refunded", chargeObject(pi, [...refunds, row]));
      return { id: row.id, paymentIntentId: pi.id, amount: row.amount, status: "succeeded" };
    },

    async listRefunds(paymentIntentId: string) {
      const rows = await db().select().from(simRefund).where(eq(simRefund.paymentIntentId, paymentIntentId));
      return rows.map((r) => ({ id: r.id, paymentIntentId: r.paymentIntentId, amount: r.amount, status: "succeeded" as const }));
    },
  };
}

/* ---------------------------------------------------- Confirming a payment */

export type SimOutcome = "succeeded" | "card_declined" | "insufficient_funds" | "expired_card" | "processing_error";

const DECLINES: Record<Exclude<SimOutcome, "succeeded">, StripeLikeError> = {
  card_declined: {
    type: "card_error",
    code: "card_declined",
    decline_code: "generic_decline",
    message: "Your card was declined.",
  },
  insufficient_funds: {
    type: "card_error",
    code: "card_declined",
    decline_code: "insufficient_funds",
    message: "Your card has insufficient funds.",
  },
  expired_card: { type: "card_error", code: "expired_card", message: "Your card has expired." },
  processing_error: {
    type: "card_error",
    code: "processing_error",
    message: "An error occurred while processing your card. Try again in a little bit.",
  },
};

export interface SimConfirmResult {
  status: "succeeded" | "requires_payment_method" | "processing";
  error: { code: string; message: string } | null;
}

/**
 * What Stripe.js `confirmPayment` does in the simulator. The guest UI sends only the
 * outcome to simulate, a brand and the last 4 digits; no card number exists here.
 */
export async function confirmSimIntent(
  id: string,
  args: { clientSecret: string; outcome: SimOutcome; brand: string; last4: string },
): Promise<SimConfirmResult> {
  const { pi } = await loadOrThrow(id);
  if (!safeEqual(pi.clientSecret, args.clientSecret)) {
    throw new SimRequestError(401, "invalid_client_secret", "The client secret does not match this payment.");
  }
  if (pi.status === "succeeded") return { status: "succeeded", error: null };
  if (pi.status === "canceled") {
    throw new SimRequestError(409, "payment_intent_unexpected_state", "This payment can no longer be completed.");
  }

  if (args.outcome === "succeeded") {
    const [row] = await db()
      .update(simPaymentIntent)
      .set({ status: "succeeded", cardBrand: args.brand, cardLast4: args.last4, lastError: null, updatedAt: new Date() })
      .where(
        and(eq(simPaymentIntent.id, id), inArray(simPaymentIntent.status, ["requires_payment_method", "requires_confirmation"])),
      )
      .returning();
    if (!row) return simStateAfterRace(id);
    await emit("payment_intent.succeeded", intentObject(row, []));
    return { status: "succeeded", error: null };
  }

  const decline = DECLINES[args.outcome];
  const [row] = await db()
    .update(simPaymentIntent)
    .set({ status: "requires_payment_method", lastError: decline, updatedAt: new Date() })
    .where(
      and(eq(simPaymentIntent.id, id), inArray(simPaymentIntent.status, ["requires_payment_method", "requires_confirmation"])),
    )
    .returning();
  if (!row) return simStateAfterRace(id);
  await emit("payment_intent.payment_failed", intentObject(row, []));
  return { status: "requires_payment_method", error: { code: decline.decline_code ?? decline.code, message: decline.message } };
}

async function simStateAfterRace(id: string): Promise<SimConfirmResult> {
  const { pi } = await loadOrThrow(id);
  if (pi.status === "succeeded") return { status: "succeeded", error: null };
  throw new SimRequestError(409, "payment_intent_unexpected_state", "This payment can no longer be completed.");
}
