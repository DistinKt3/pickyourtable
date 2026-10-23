import { eq } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { POST as webhookPost } from "@/app/api/stripe/webhook/route";
import { db } from "@/db/client";
import { simPaymentIntent, webhookEvent } from "@/db/schema";
import { tick } from "@/lib/booking/jobs";
import { resetEnvCache } from "@/lib/env";
import { deliverSimEvent, listSimEvents } from "@/lib/payments/sim";
import { signWebhook } from "@/lib/payments/webhook";
import {
  book,
  call,
  checkout,
  day,
  emailsFor,
  expireHold,
  heldOk,
  holdStatus,
  nextWeekday,
  pay,
  refundedAtProvider,
  resetBookingData,
  row,
} from "./helpers";

beforeAll(async () => {
  process.env.SIM_WEBHOOK_DELIVERY = "inline";
  await resetBookingData();
});

afterEach(() => {
  process.env.SIM_WEBHOOK_DELIVERY = "inline";
});

async function eventsOf(paymentIntentId: string, type?: string) {
  const all = await listSimEvents({ paymentIntentId });
  return type ? all.filter((e) => e.type === type) : all;
}

function postWebhook(payload: string, signature?: string) {
  return call<{ received: boolean; duplicate?: boolean; outcome?: string; error?: { code: string } }>(
    webhookPost,
    "/api/stripe/webhook",
    {},
    { body: payload, headers: signature ? { "stripe-signature": signature, origin: "https://stripe.example" } : {} },
  );
}

describe("checkout and payment (G-7)", () => {
  it("confirms only after the provider reports success, then emails the guest and the venue (G-8, O-5)", async () => {
    const fri = nextWeekday(5, 3);
    const h = await heldOk({ table: "W1", date: fri, time: "20:00" });
    const c = await checkout(h.hold.id, h.holdToken, "pat@example.com");
    expect(c.body.payment.clientSecret).toMatch(/^pi_sim_[a-f0-9]{24}_secret_/);
    // A payment that has not happened yet confirms nothing.
    let s = await holdStatus(h.hold.id, h.holdToken);
    expect(s.body.hold.status).toBe("held");
    expect(s.body.payment).toEqual({ status: "requires_payment", message: null });
    expect(s.body.booking).toBeNull();

    const declined = await pay(c.body.payment.paymentIntentId, c.body.payment.clientSecret, "insufficient_funds");
    expect(declined.body).toEqual({
      status: "requires_payment_method",
      error: { code: "insufficient_funds", message: "Your card has insufficient funds." },
    });
    s = await holdStatus(h.hold.id, h.holdToken);
    expect(s.body.hold.status).toBe("held");
    expect(s.body.payment).toEqual({
      status: "failed",
      message: "Your bank declined this payment. Try another card or payment method.",
    });

    const ok = await pay(c.body.payment.paymentIntentId, c.body.payment.clientSecret, "succeeded", "mastercard");
    expect(ok.body).toEqual({ status: "succeeded", error: null });
    s = await holdStatus(h.hold.id, h.holdToken);
    expect(s.body.hold.status).toBe("confirmed");
    expect(s.body.payment).toEqual({ status: "succeeded", message: null });
    expect(s.body.booking).toMatchObject({ emailedTo: "pat@example.com" });
    expect(s.body.booking!.manageUrl).toMatch(/^http:\/\/localhost:3000\/v\/halcyon\/manage\/[\w-]+\.[\w-]+\.[\w-]+$/);
    expect(s.body.booking!.calendarUrl).toMatch(/^\/api\/manage\/.+\/calendar$/);

    const r = await row(h.hold.id);
    expect(r).toMatchObject({ status: "confirmed", cardBrand: "mastercard", cardLast4: "4242", paymentError: null });
    const guestMail = await emailsFor(h.hold.id, "booking-confirmed");
    expect(guestMail).toHaveLength(1);
    expect(guestMail[0]!.to).toBe("pat@example.com");
    expect(guestMail[0]!.html).toContain("/venues/halcyon/renders/W1-email.jpg");
    expect(guestMail[0]!.html).toContain(s.body.booking!.manageUrl);
    expect(guestMail[0]!.attachments).toEqual([
      expect.objectContaining({ name: `halcyon-${fri}.ics`, contentType: expect.stringContaining("text/calendar") }),
    ]);
    const venueMail = await emailsFor(h.hold.id, "venue-booking-new");
    expect(venueMail).toHaveLength(1);
    expect(venueMail[0]!.to).toBe("reservations@halcyon.example");
  });

  it("the simulator checks the client secret and never takes card numbers", async () => {
    const h = await heldOk({ table: "W2", date: day(5), time: "20:00" });
    const c = await checkout(h.hold.id, h.holdToken);
    const wrong = await pay(c.body.payment.paymentIntentId, `${c.body.payment.paymentIntentId}_secret_wrongwrongwrong`);
    expect(wrong.status).toBe(401);
    const res = await call(
      (await import("@/app/api/sim/payment-intents/[id]/confirm/route")).POST,
      `/api/sim/payment-intents/${c.body.payment.paymentIntentId}/confirm`,
      { id: c.body.payment.paymentIntentId },
      {
        body: {
          clientSecret: c.body.payment.clientSecret,
          outcome: "succeeded",
          brand: "visa",
          last4: "4242",
          number: "4242424242424242",
        },
      },
    );
    expect(res.status).toBe(200);
    const [pi] = await db().select().from(simPaymentIntent).where(eq(simPaymentIntent.id, c.body.payment.paymentIntentId));
    expect(JSON.stringify(pi)).not.toContain("4242424242424242");
  });

  it("the simulator endpoint does not exist in stripe mode", async () => {
    const saved = { ...process.env };
    Object.assign(process.env, {
      PAYMENTS_MODE: "stripe",
      STRIPE_SECRET_KEY: "sk_test_placeholder",
      STRIPE_PUBLISHABLE_KEY: "pk_test_placeholder",
      STRIPE_WEBHOOK_SECRET: "whsec_placeholder",
    });
    resetEnvCache();
    try {
      const res = await pay("pi_sim_000000000000000000000000", "pi_sim_000000000000000000000000_secret_x");
      expect(res.status).toBe(404);
    } finally {
      for (const k of ["STRIPE_SECRET_KEY", "STRIPE_PUBLISHABLE_KEY", "STRIPE_WEBHOOK_SECRET"]) delete process.env[k];
      process.env.PAYMENTS_MODE = saved.PAYMENTS_MODE;
      resetEnvCache();
    }
  });
});

describe("webhooks (red team: replayed or out-of-order events)", () => {
  it("rejects a bad, missing or stale signature", async () => {
    const payload = JSON.stringify({
      id: "evt_forged",
      object: "event",
      type: "payment_intent.succeeded",
      data: { object: { id: "pi_x" } },
    });
    expect((await postWebhook(payload, "t=1700000000,v1=deadbeef")).status).toBe(400);
    expect((await postWebhook(payload)).status).toBe(400);
    const stale = signWebhook(payload, Math.floor(Date.now() / 1000) - 3600);
    expect((await postWebhook(payload, stale)).status).toBe(400);
    const tampered = signWebhook(payload);
    expect((await postWebhook(payload.replace("pi_x", "pi_y"), tampered)).status).toBe(400);
    const none = await db().select().from(webhookEvent).where(eq(webhookEvent.id, "evt_forged"));
    expect(none).toHaveLength(0);
  });

  it("a replayed event confirms once and sends one email", async () => {
    process.env.SIM_WEBHOOK_DELIVERY = "manual";
    const h = await heldOk({ table: "W3", date: day(6), time: "19:00" });
    const c = await checkout(h.hold.id, h.holdToken);
    await pay(c.body.payment.paymentIntentId, c.body.payment.clientSecret);
    expect((await row(h.hold.id)).status).toBe("held");
    const [succeeded] = await eventsOf(c.body.payment.paymentIntentId, "payment_intent.succeeded");
    const first = await deliverSimEvent(succeeded!.id);
    expect(first.body).toMatchObject({ received: true, outcome: "confirmed" });
    const replay = await deliverSimEvent(succeeded!.id);
    expect(replay.body).toMatchObject({ received: true, duplicate: true });
    // The same event through the HTTP endpoint is also a 200 no-op.
    const payload = JSON.stringify(succeeded!.payload);
    const viaHttp = await postWebhook(payload, signWebhook(payload));
    expect(viaHttp.status).toBe(200);
    expect(viaHttp.body.duplicate).toBe(true);
    expect((await row(h.hold.id)).status).toBe("confirmed");
    expect(await emailsFor(h.hold.id, "booking-confirmed")).toHaveLength(1);
  });

  it("failed then succeeded, delivered in either order, ends confirmed with no error", async () => {
    process.env.SIM_WEBHOOK_DELIVERY = "manual";
    for (const order of ["in-order", "reversed"] as const) {
      const h = await heldOk({ table: order === "in-order" ? "W4" : "W5", date: day(6), time: "19:00" });
      const c = await checkout(h.hold.id, h.holdToken);
      await pay(c.body.payment.paymentIntentId, c.body.payment.clientSecret, "card_declined");
      await pay(c.body.payment.paymentIntentId, c.body.payment.clientSecret, "succeeded");
      const failed = (await eventsOf(c.body.payment.paymentIntentId, "payment_intent.payment_failed"))[0]!;
      const succeeded = (await eventsOf(c.body.payment.paymentIntentId, "payment_intent.succeeded"))[0]!;
      const sequence = order === "in-order" ? [failed, succeeded] : [succeeded, failed];
      for (const e of sequence) expect((await deliverSimEvent(e.id)).status).toBe(200);
      const r = await row(h.hold.id);
      expect({ order, status: r.status }).toEqual({ order, status: "confirmed" });
      expect(r.paymentError).toBeNull();
      expect(await emailsFor(h.hold.id, "booking-confirmed")).toHaveLength(1);
    }
  });

  it("a late webhook does not strand a paid guest: the status poll confirms through the same path", async () => {
    process.env.SIM_WEBHOOK_DELIVERY = "manual";
    const h = await heldOk({ table: "W6", date: day(6), time: "19:00" });
    const c = await checkout(h.hold.id, h.holdToken);
    await pay(c.body.payment.paymentIntentId, c.body.payment.clientSecret);
    const s = await holdStatus(h.hold.id, h.holdToken);
    expect(s.body.hold.status).toBe("confirmed");
    expect(s.body.booking).not.toBeNull();
    const [succeeded] = await eventsOf(c.body.payment.paymentIntentId, "payment_intent.succeeded");
    expect((await deliverSimEvent(succeeded!.id)).body).toMatchObject({ outcome: "already_confirmed" });
    expect(await emailsFor(h.hold.id, "booking-confirmed")).toHaveLength(1);
  });
});

describe("payment after the hold expired (S-3)", () => {
  it("is kept when the table is still free", async () => {
    const h = await heldOk({ table: "C1", date: day(7), time: "19:00" });
    const c = await checkout(h.hold.id, h.holdToken);
    await expireHold(h.hold.id);
    await tick();
    expect((await row(h.hold.id)).status).toBe("expired");
    // The job cancelled the payment, so a late attempt cannot charge the guest.
    const late = await pay(c.body.payment.paymentIntentId, c.body.payment.clientSecret);
    expect(late.status).toBe(409);

    // When the payment lands before the job runs, the booking is kept.
    const h2 = await heldOk({ table: "C2", date: day(7), time: "19:00" });
    const c2 = await checkout(h2.hold.id, h2.holdToken);
    await expireHold(h2.hold.id);
    await pay(c2.body.payment.paymentIntentId, c2.body.payment.clientSecret);
    expect((await row(h2.hold.id)).status).toBe("confirmed");
    expect(await refundedAtProvider(c2.body.payment.paymentIntentId)).toBe(0);
  });

  it("is refunded in full at once, with an email, when the table was held again (webhook path)", async () => {
    const date = day(8);
    const a = await heldOk({ table: "T1", date, time: "19:00" });
    const ca = await checkout(a.hold.id, a.holdToken, "late.guest@example.com");
    await expireHold(a.hold.id);
    const b = await heldOk({ table: "T1", date, time: "19:00" });
    const paid = await pay(ca.body.payment.paymentIntentId, ca.body.payment.clientSecret);
    expect(paid.body.status).toBe("succeeded");

    const ra = await row(a.hold.id);
    expect(ra).toMatchObject({
      status: "expired",
      cancelReason: "late_payment",
      refundCents: ra.priceCents,
      refundDueCents: ra.priceCents,
    });
    expect(await refundedAtProvider(ca.body.payment.paymentIntentId)).toBe(ra.priceCents);
    expect((await row(b.hold.id)).status).toBe("held");
    const mail = await emailsFor(a.hold.id, "late-payment-refunded");
    expect(mail).toHaveLength(1);
    expect(mail[0]!.to).toBe("late.guest@example.com");
    expect(mail[0]!.subject).toBe("We could not keep your table at Halcyon");
    expect(await emailsFor(a.hold.id, "booking-confirmed")).toHaveLength(0);
    const s = await holdStatus(a.hold.id, a.holdToken);
    expect(s.body.payment.status).toBe("failed");
    expect(s.body.payment.message).toContain("refunded it in full");
  });

  it("refunded before succeeded: the job refunds first, then both events arrive in reverse order", async () => {
    process.env.SIM_WEBHOOK_DELIVERY = "manual";
    const date = day(9);
    const a = await heldOk({ table: "T2", date, time: "19:00" });
    const ca = await checkout(a.hold.id, a.holdToken);
    await expireHold(a.hold.id);
    await pay(ca.body.payment.paymentIntentId, ca.body.payment.clientSecret);
    const b = await heldOk({ table: "T2", date, time: "19:00" });
    const report = await tick();
    expect(report.latePayments).toBe(1);
    const price = (await row(a.hold.id)).priceCents;
    expect(await refundedAtProvider(ca.body.payment.paymentIntentId)).toBe(price);

    const refunded = (await eventsOf(ca.body.payment.paymentIntentId, "charge.refunded"))[0]!;
    const succeeded = (await eventsOf(ca.body.payment.paymentIntentId, "payment_intent.succeeded"))[0]!;
    expect((await deliverSimEvent(refunded.id)).body).toMatchObject({ outcome: "refund_recorded" });
    expect((await deliverSimEvent(succeeded.id)).body).toMatchObject({ outcome: "already_refunded" });

    const ra = await row(a.hold.id);
    expect(ra).toMatchObject({ status: "expired", refundCents: price, refundDueCents: price });
    expect((await row(b.hold.id)).status).toBe("held");
    expect(await emailsFor(a.hold.id, "late-payment-refunded")).toHaveLength(1);
    expect(await refundedAtProvider(ca.body.payment.paymentIntentId)).toBe(price);
  });

  it("a refund made outside the app (such as in the Stripe dashboard) is recorded on the booking", async () => {
    process.env.SIM_WEBHOOK_DELIVERY = "manual";
    const a = await book({ table: "T3", date: day(10), time: "19:00" });
    const before = await row(a.holdId);
    // The provider reports a refund made outside the app (for example, from the Stripe dashboard).
    const { payments } = await import("@/lib/payments");
    await payments().refund({
      paymentIntentId: a.paymentIntentId,
      amount: 500,
      metadata: {},
      idempotencyKey: `dashboard-${a.holdId}`,
    });
    const [refunded] = await eventsOf(a.paymentIntentId, "charge.refunded");
    await deliverSimEvent(refunded!.id);
    const after = await row(a.holdId);
    expect(after.status).toBe("confirmed");
    expect(after.refundCents).toBe(before.refundCents + 500);
  });
});
