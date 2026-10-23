"use client";

import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { type Appearance, loadStripe, type Stripe } from "@stripe/stripe-js";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import type { CheckoutResponse } from "@/lib/api/contracts";
import { formatMoney } from "@/lib/format";

/**
 * Stripe Payment Element (PRD G-7): Apple Pay, Google Pay or card, collected by
 * Stripe in its own frames, so card data never touches our servers (PCI SAQ A).
 * Loaded only at this step, keeping Stripe out of the first page load.
 */

const stripes = new Map<string, Promise<Stripe | null>>();
function stripeFor(key: string) {
  if (!stripes.has(key)) stripes.set(key, loadStripe(key));
  return stripes.get(key)!;
}

function readToken(name: string, fallback: string): string {
  const root = document.querySelector("[data-pyt-root]") ?? document.documentElement;
  const v = getComputedStyle(root).getPropertyValue(name).trim();
  return v || fallback;
}

export function StripePay(props: {
  payment: CheckoutResponse["payment"];
  venueName: string;
  confirming: boolean;
  onPaid: () => Promise<void>;
  onError: (message: string) => void;
  returnPath: string;
}) {
  const { payment } = props;
  const options = useMemo(() => {
    const dark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    const appearance: Appearance = {
      theme: dark ? "night" : "stripe",
      variables: {
        colorPrimary: readToken("--accent-base", "#1f5a63"),
        colorBackground: readToken("--surface-1", dark ? "#1b1916" : "#fffdf9"),
        colorText: readToken("--ink", dark ? "#f3efe8" : "#1d1b18"),
        colorDanger: readToken("--danger", "#a3362a"),
        borderRadius: "12px",
        fontSizeBase: "16px",
        spacingUnit: "4px",
      },
    };
    return { clientSecret: payment.clientSecret, appearance };
  }, [payment.clientSecret]);

  if (!payment.publishableKey) return null;
  return (
    <Elements stripe={stripeFor(payment.publishableKey)} options={options}>
      <StripeForm {...props} />
    </Elements>
  );
}

function StripeForm({
  payment,
  venueName,
  confirming,
  onPaid,
  onError,
  returnPath,
}: {
  payment: CheckoutResponse["payment"];
  venueName: string;
  confirming: boolean;
  onPaid: () => Promise<void>;
  onError: (message: string) => void;
  returnPath: string;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);

  const pay = async () => {
    if (!stripe || !elements) return;
    setBusy(true);
    const { error, paymentIntent } = await stripe.confirmPayment({
      elements,
      redirect: "if_required",
      confirmParams: { return_url: `${window.location.origin}${returnPath}` },
    });
    setBusy(false);
    if (error) {
      onError(error.message ?? "Your payment did not go through.");
      return;
    }
    if (paymentIntent && (paymentIntent.status === "succeeded" || paymentIntent.status === "processing")) await onPaid();
  };

  return (
    <div>
      <PaymentElement
        onReady={() => setReady(true)}
        options={{ layout: { type: "tabs" }, business: { name: venueName }, wallets: { applePay: "auto", googlePay: "auto" } }}
      />
      <Button size="lg" block className="mt-5" disabled={!ready} loading={busy || confirming} onClick={() => void pay()}>
        Pay {formatMoney(payment.amountCents)}
      </Button>
    </div>
  );
}
