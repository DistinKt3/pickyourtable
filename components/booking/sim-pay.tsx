"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { CheckoutResponse } from "@/lib/api/contracts";
import { cx, formatMoney } from "@/lib/format";
import { ApiFailure, api } from "./api";

/**
 * The payment step in simulated mode (no Stripe keys in this environment). It never
 * collects a card number: the guest picks one of Stripe's documented test outcomes,
 * and only that outcome, a brand and the last four digits reach the server.
 */

const METHODS = [
  { id: "apple", label: "Apple Pay", note: "Test wallet", outcome: "succeeded", brand: "apple_pay", last4: "4242" },
  { id: "google", label: "Google Pay", note: "Test wallet", outcome: "succeeded", brand: "google_pay", last4: "4242" },
  { id: "visa", label: "Visa ending 4242", note: "Test card, succeeds", outcome: "succeeded", brand: "visa", last4: "4242" },
  {
    id: "declined",
    label: "Visa ending 0002",
    note: "Test card, declined",
    outcome: "card_declined",
    brand: "visa",
    last4: "0002",
  },
  {
    id: "funds",
    label: "Visa ending 9995",
    note: "Test card, insufficient funds",
    outcome: "insufficient_funds",
    brand: "visa",
    last4: "9995",
  },
] as const;

export function SimPay({
  payment,
  confirming,
  onPaid,
  onError,
}: {
  payment: CheckoutResponse["payment"];
  confirming: boolean;
  onPaid: () => Promise<void>;
  onError: (message: string) => void;
}) {
  const [method, setMethod] = useState<(typeof METHODS)[number]["id"]>("apple");
  const [busy, setBusy] = useState(false);

  const pay = async () => {
    const m = METHODS.find((x) => x.id === method)!;
    setBusy(true);
    try {
      const res = await api.simConfirm(payment.paymentIntentId, {
        clientSecret: payment.clientSecret,
        outcome: m.outcome,
        brand: m.brand,
        last4: m.last4,
      });
      if (res.status === "succeeded") await onPaid();
      else onError(res.error?.message ?? "Your payment was declined.");
    } catch (e) {
      onError(e instanceof ApiFailure ? e.message : "Your payment did not go through.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <fieldset>
        <legend className="mb-2 text-base font-medium">Payment method</legend>
        <p className="mb-3 text-sm text-ink-3">Simulated Stripe test mode. No real card is charged.</p>
        <div className="flex flex-col gap-2">
          {METHODS.map((m) => (
            <label
              key={m.id}
              className={cx(
                "flex min-h-14 cursor-pointer items-center gap-3 rounded-card bg-surface-1 px-4 hairline transition-shadow duration-150",
                method === m.id && "shadow-[inset_0_0_0_2px_var(--accent-base)]",
              )}
            >
              <input
                type="radio"
                name="sim-method"
                value={m.id}
                checked={method === m.id}
                onChange={() => setMethod(m.id)}
                className="size-4 accent-[var(--accent-base)]"
              />
              <span className="flex-1 font-medium">
                {m.label}
                <span className="block text-sm font-normal text-ink-3">{m.note}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      <Button size="lg" block className="mt-5" loading={busy || confirming} onClick={() => void pay()}>
        Pay {formatMoney(payment.amountCents)}
      </Button>
    </div>
  );
}
