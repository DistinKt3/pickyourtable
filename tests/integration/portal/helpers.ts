import { NextRequest } from "next/server";
import { issueMagicLink, redeemMagicLink, sessionCookieName } from "@/lib/auth/session";

/** Shared helpers for portal route tests: sign in without email, build requests, call handlers. */

export const ORIGIN = "http://localhost:3000";

export const HALCYON_OWNER = "owner@halcyon.example";
export const HALCYON_HOST = "host@halcyon.example";
export const ORCHARD_OWNER = "owner@orchard-room.example";
export const ORCHARD_HOST = "host@orchard-room.example";

/** A session cookie header for an operator, through the real magic-link functions. */
export async function signIn(email: string): Promise<string> {
  const issued = await issueMagicLink(email);
  if (!issued) throw new Error(`no operator ${email}`);
  const session = await redeemMagicLink(issued.token);
  if (!session) throw new Error("could not redeem");
  return `${sessionCookieName()}=${session.sessionToken}`;
}

let ipCounter = 0;

/** A fresh client IP per call by default, so per-IP limits do not leak between tests. */
export function nextIp(): string {
  ipCounter += 1;
  return `203.0.113.${ipCounter % 250}`;
}

export interface RequestOptions {
  body?: unknown;
  form?: Record<string, string>;
  cookie?: string;
  origin?: string | null;
  ip?: string;
}

export function request(method: string, path: string, opts: RequestOptions = {}): NextRequest {
  const headers = new Headers({ "x-forwarded-for": opts.ip ?? nextIp() });
  if (opts.cookie) headers.set("cookie", opts.cookie);
  if (opts.origin !== null && method !== "GET") headers.set("origin", opts.origin ?? ORIGIN);
  let body: string | undefined;
  if (opts.form) {
    headers.set("content-type", "application/x-www-form-urlencoded");
    body = new URLSearchParams(opts.form).toString();
  } else if (opts.body !== undefined) {
    headers.set("content-type", "application/json");
    body = JSON.stringify(opts.body);
  }
  return new NextRequest(new URL(path, ORIGIN), { method, headers, body });
}

type Handler = (req: NextRequest, route: { params: Promise<Record<string, string | string[]>> }) => Promise<Response>;

export interface Result<T = Record<string, unknown>> {
  status: number;
  body: T;
  res: Response;
}

/** Calls a route handler the way Next.js does and parses the JSON answer. */
export async function call<T = Record<string, unknown>>(
  handler: Handler,
  req: NextRequest,
  params: Record<string, string> = {},
): Promise<Result<T>> {
  const res = await handler(req, { params: Promise.resolve(params) });
  const text = await res.clone().text();
  return { status: res.status, body: (text ? JSON.parse(text) : null) as T, res };
}

export function errorCode(r: Result): string | undefined {
  return (r.body as { error?: { code?: string } }).error?.code;
}
