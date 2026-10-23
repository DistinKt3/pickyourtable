import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { POST as cancelPost } from "@/app/api/manage/[token]/cancel/route";
import { book, call, day, resetBookingData } from "./helpers";

/**
 * PRD S-6: every hold, payment, webhook and refund writes one log line with IDs,
 * amounts and outcome, and no line carries a guest's email in the clear or a card.
 */

beforeAll(async () => {
  process.env.SIM_WEBHOOK_DELIVERY = "inline";
  await resetBookingData();
});

afterEach(() => {
  vi.restoreAllMocks();
});

type Line = Record<string, unknown> & { event: string; level: string };

function capture(): Line[] {
  const lines: Line[] = [];
  for (const m of ["log", "warn", "error"] as const) {
    vi.spyOn(console, m).mockImplementation((l: unknown) => {
      if (typeof l === "string" && l.startsWith("{")) lines.push(JSON.parse(l) as Line);
    });
  }
  return lines;
}

describe("structured logs (S-6)", () => {
  it("a hold, its payment, the webhooks and a refund each write one line with ids, amounts and outcome", async () => {
    const lines = capture();
    const b = await book({ table: "C3", date: day(30), time: "19:00", email: "logged.guest@example.com" });
    const res = await call(cancelPost, `/api/manage/${b.manageToken}/cancel`, { token: b.manageToken }, { method: "POST" });
    expect(res.status).toBe(200);
    vi.restoreAllMocks();

    const id = b.holdId;
    const one = (event: string, match: Record<string, unknown> = {}) => {
      const found = lines.filter((l) => l.event === event && Object.entries(match).every(([k, v]) => l[k] === v));
      expect(found, `${event} ${JSON.stringify(match)}`).toHaveLength(1);
      return found[0]!;
    };
    expect(one("hold.created", { holdId: id })).toMatchObject({
      venueId: "halcyon",
      table: "C3",
      priceCents: b.priceCents,
      outcome: "held",
    });
    expect(one("payment.intent_ready", { reservationId: id })).toMatchObject({
      paymentIntentId: b.paymentIntentId,
      amountCents: b.priceCents,
      outcome: "created",
    });
    expect(one("payment.succeeded", { reservationId: id })).toMatchObject({ amountCents: b.priceCents, outcome: "confirmed" });
    expect(one("webhook.received", { type: "payment_intent.succeeded" })).toMatchObject({
      eventId: expect.stringMatching(/^evt_/),
      reservationId: id,
      amountCents: b.priceCents,
      outcome: "confirmed",
    });
    expect(one("webhook.received", { type: "charge.refunded" })).toMatchObject({ reservationId: id, outcome: "refund_recorded" });
    expect(one("refund.issued", { reservationId: id })).toMatchObject({
      refundId: expect.stringMatching(/^re_/),
      amountCents: b.priceCents,
      outcome: "succeeded",
    });
    expect(one("booking.cancelled", { reservationId: id })).toMatchObject({ refundCents: b.priceCents, outcome: "full" });

    const text = lines.map((l) => JSON.stringify(l)).join("\n");
    expect(text).not.toContain("logged.guest@example.com");
    expect(text).toContain("l***@example.com");
    expect(text).not.toMatch(/4242 ?4242|cvc|client_secret/i);
    expect(text).not.toContain(b.manageToken);
  });
});
