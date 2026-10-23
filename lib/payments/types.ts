/**
 * One payments interface with two implementations (lib/payments/stripe.ts and the
 * local simulator lib/payments/sim.ts), selected by PAYMENTS_MODE. The booking code
 * only ever talks to this interface, so the same paths run in both modes.
 *
 * Card numbers never pass through here: the guest's card goes to Stripe Elements (or,
 * in the simulator, the guest UI sends only an outcome, a brand and the last 4 digits).
 */

export type PaymentsMode = "stripe" | "sim";

export type IntentStatus =
  | "requires_payment_method"
  | "requires_confirmation"
  | "requires_action"
  | "processing"
  | "requires_capture"
  | "canceled"
  | "succeeded";

export interface IntentMetadata {
  reservation_id: string;
  venue_id: string;
  table: string;
  [key: string]: string;
}

export interface CreateIntentInput {
  amount: number;
  currency: "usd";
  /** The platform's share; the rest goes to the venue's connected account. */
  applicationFeeAmount: number;
  /** The venue's connected account (destination charge). */
  destination: string;
  metadata: IntentMetadata;
  receiptEmail: string;
  description: string;
  idempotencyKey: string;
}

export interface PaymentError {
  code: string | null;
  declineCode: string | null;
  message: string | null;
}

export interface PaymentIntentInfo {
  id: string;
  clientSecret: string | null;
  amount: number;
  amountReceived: number;
  /** Refunded so far on the intent's charge. */
  amountRefunded: number;
  currency: string;
  status: IntentStatus;
  applicationFeeAmount: number | null;
  destination: string | null;
  metadata: Record<string, string>;
  /** Brand (or wallet, such as apple_pay) and last 4 of the paying card. */
  card: { brand: string; last4: string } | null;
  lastError: PaymentError | null;
}

export interface RefundInput {
  paymentIntentId: string;
  amount: number;
  reason?: "requested_by_customer" | "duplicate";
  metadata: Record<string, string>;
  idempotencyKey: string;
}

export interface RefundInfo {
  id: string;
  paymentIntentId: string;
  amount: number;
  status: "pending" | "succeeded" | "failed" | "canceled" | "requires_action";
}

export type CancelResult = { canceled: true; intent: PaymentIntentInfo } | { canceled: false; intent: PaymentIntentInfo };

export interface PaymentsProvider {
  readonly mode: PaymentsMode;
  /** Stripe publishable key in stripe mode; null in the simulator. */
  readonly publishableKey: string | null;
  createPaymentIntent(input: CreateIntentInput): Promise<PaymentIntentInfo>;
  retrievePaymentIntent(id: string): Promise<PaymentIntentInfo>;
  updateReceiptEmail(id: string, email: string): Promise<void>;
  /** Cancels an unpaid intent. When it has already succeeded (or is processing), says so instead. */
  cancelPaymentIntent(id: string): Promise<CancelResult>;
  refund(input: RefundInput): Promise<RefundInfo>;
  listRefunds(paymentIntentId: string): Promise<RefundInfo[]>;
}

/** Intent states in which money may still move, so the intent should be cancelled when its hold ends. */
export const OPEN_INTENT_STATES: readonly IntentStatus[] = [
  "requires_payment_method",
  "requires_confirmation",
  "requires_action",
  "requires_capture",
];
