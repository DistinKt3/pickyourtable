import { randomBytes } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { NextRequest } from "next/server";
import { expect } from "vitest";
import { GET as holdGet } from "@/app/api/holds/[id]/route";
import { POST as checkoutPost } from "@/app/api/holds/[id]/checkout/route";
import { POST as simConfirm } from "@/app/api/sim/payment-intents/[id]/confirm/route";
import { POST as holdsPost } from "@/app/api/v/[venue]/holds/route";
import { db } from "@/db/client";
import { emailMessage, reservation, simRefund } from "@/db/schema";
import type { CheckoutResponse, CreateHoldResponse, HoldStatusResponse } from "@/lib/api/contracts";
import { addDays, isoWeekday, todayIn } from "@/lib/format";

/** Helpers for booking integration tests: route handlers are called directly. */

export const ORIGIN = "http://localhost:3000";
export const LA = "America/Los_Angeles";

type Handler = (req: NextRequest, route: { params: Promise<Record<string, string | string[]>> }) => Promise<Response>;

// A per-run prefix keeps rate-limit keys apart from earlier runs and other files.
const ipBase = randomBytes(2);
let ipCount = 0;

/** A fresh client IP (tests run with TRUST_PROXY=xff). */
export function nextIp(): string {
  ipCount++;
  return `10.${ipBase[0]! ^ (ipCount >> 16)}.${(ipBase[1]! + (ipCount >> 8)) & 255}.${ipCount & 255}`;
}

/** A fresh device id, as the widget keeps in local storage. */
export function nextDevice(): string {
  return randomBytes(12).toString("base64url");
}

let emailCount = 0;
export function nextEmail(): string {
  emailCount++;
  return `guest${emailCount}.${randomBytes(3).toString("hex")}@example.com`;
}

export interface CallOptions {
  method?: string;
  body?: unknown;
  ip?: string;
  device?: string;
  token?: string;
  headers?: Record<string, string>;
}

export function request(path: string, o: CallOptions = {}): NextRequest {
  const method = o.method ?? (o.body === undefined ? "GET" : "POST");
  const headers: Record<string, string> = { "x-forwarded-for": o.ip ?? nextIp(), ...o.headers };
  if (method !== "GET" && method !== "HEAD") headers.origin ??= ORIGIN;
  if (o.body !== undefined) headers["content-type"] = "application/json";
  if (o.device) headers["x-pyt-device"] = o.device;
  if (o.token) headers.authorization = `Bearer ${o.token}`;
  return new NextRequest(new URL(path, ORIGIN), {
    method,
    headers,
    ...(o.body !== undefined ? { body: typeof o.body === "string" ? o.body : JSON.stringify(o.body) } : {}),
  });
}

export interface Result<T> {
  status: number;
  body: T;
  headers: Headers;
}

export async function call<T = Record<string, unknown>>(
  handler: Handler,
  path: string,
  params: Record<string, string>,
  o: CallOptions = {},
): Promise<Result<T>> {
  const res = await handler(request(path, o), { params: Promise.resolve(params) });
  const text = await res.text();
  let body: unknown = text;
  try {
    body = JSON.parse(text);
  } catch {
    // Not JSON (a calendar file, say).
  }
  return { status: res.status, body: body as T, headers: res.headers };
}

/** A date `n` days from today in Los Angeles. */
export function day(n: number, tz = LA): string {
  return addDays(todayIn(tz), n);
}

/** The first date at least `n` days ahead with ISO weekday `weekday`. */
export function nextWeekday(weekday: number, n = 3, tz = LA): string {
  let d = day(n, tz);
  while (isoWeekday(d) !== weekday) d = addDays(d, 1);
  return d;
}

export interface HoldArgs {
  venue?: string;
  table: string;
  date: string;
  time: string;
  party?: number;
  ip?: string;
  device?: string;
  turnstileToken?: string | null;
  extra?: Record<string, unknown>;
}

export function hold(a: HoldArgs) {
  const venue = a.venue ?? "halcyon";
  const body: Record<string, unknown> = { table: a.table, date: a.date, time: a.time, party: a.party ?? 2, ...a.extra };
  if (a.turnstileToken !== null) body.turnstileToken = a.turnstileToken ?? "XXXX.DUMMY.TOKEN.XXXX";
  return call<CreateHoldResponse & { error?: { code: string; message: string; alternative?: unknown } }>(
    holdsPost,
    `/api/v/${venue}/holds`,
    { venue },
    { body, ip: a.ip, device: a.device ?? nextDevice() },
  );
}

export async function heldOk(a: HoldArgs): Promise<CreateHoldResponse> {
  const res = await hold(a);
  if (res.status !== 201) throw new Error(`hold failed with ${res.status}: ${JSON.stringify(res.body)}`);
  return res.body;
}

export function checkout(holdId: string, token: string, email = nextEmail(), extra: Record<string, unknown> = {}) {
  return call<CheckoutResponse & { error?: { code: string } }>(
    checkoutPost,
    `/api/holds/${holdId}/checkout`,
    { id: holdId },
    {
      token,
      body: {
        guest: {
          name: "Robin Example",
          email,
          mobile: "+1 415 555 0100",
          occasion: "anniversary",
          note: "By the window if we can",
        },
        ...extra,
      },
    },
  );
}

export function pay(paymentIntentId: string, clientSecret: string, outcome = "succeeded", brand = "visa") {
  return call<{ status: string; error: { code: string; message: string } | null }>(
    simConfirm,
    `/api/sim/payment-intents/${paymentIntentId}/confirm`,
    { id: paymentIntentId },
    { body: { clientSecret, outcome, brand, last4: "4242" } },
  );
}

export function holdStatus(holdId: string, token: string) {
  return call<HoldStatusResponse>(holdGet, `/api/holds/${holdId}`, { id: holdId }, { token });
}

export interface Booked {
  holdId: string;
  holdToken: string;
  paymentIntentId: string;
  clientSecret: string;
  priceCents: number;
  manageToken: string;
  email: string;
}

/** Hold, check out and pay; with inline webhook delivery the booking is confirmed on return. */
export async function book(a: HoldArgs & { email?: string }): Promise<Booked> {
  const h = await heldOk(a);
  const email = a.email ?? nextEmail();
  const c = await checkout(h.hold.id, h.holdToken, email);
  if (c.status !== 200) throw new Error(`checkout failed with ${c.status}: ${JSON.stringify(c.body)}`);
  const p = await pay(c.body.payment.paymentIntentId, c.body.payment.clientSecret);
  expect(p.status).toBe(200);
  const s = await holdStatus(h.hold.id, h.holdToken);
  expect(s.body.hold.status).toBe("confirmed");
  const manageToken = s.body.booking!.manageUrl.split("/manage/")[1]!;
  return {
    holdId: h.hold.id,
    holdToken: h.holdToken,
    paymentIntentId: c.body.payment.paymentIntentId,
    clientSecret: c.body.payment.clientSecret,
    priceCents: h.hold.priceCents,
    manageToken,
    email,
  };
}

export async function row(id: string) {
  const [r] = await db().select().from(reservation).where(eq(reservation.id, id));
  return r!;
}

export async function expireHold(id: string) {
  await db().execute(sql`UPDATE reservation SET hold_expires_at = now() - interval '1 second' WHERE id = ${id}`);
}

export async function emailsFor(reservationId: string, tag?: string) {
  const rows = await db().select().from(emailMessage).where(eq(emailMessage.reservationId, reservationId));
  return tag ? rows.filter((m) => m.tag === tag) : rows;
}

export async function refundedAtProvider(paymentIntentId: string): Promise<number> {
  const rows = await db().select().from(simRefund).where(eq(simRefund.paymentIntentId, paymentIntentId));
  return rows.reduce((s, r) => s + r.amount, 0);
}

/** Clears booking state so each file starts from the seeded venues only. */
export async function resetBookingData() {
  await db().execute(sql`
    TRUNCATE reservation, guest, blackout, webhook_event, sim_payment_intent, sim_refund, sim_event,
             email_message, audit_log, rate_limit RESTART IDENTITY CASCADE
  `);
}
