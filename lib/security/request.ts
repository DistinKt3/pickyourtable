import "server-only";
import { env } from "@/lib/env";
import { hashIdentifier } from "./crypto";

/** Client IP, from the one header the deployment says it can trust. */
export function clientIp(req: Request): string {
  const mode = env().TRUST_PROXY;
  if (mode === "vercel") {
    const v = req.headers.get("x-vercel-forwarded-for") ?? req.headers.get("x-real-ip");
    if (v) return v.split(",")[0]!.trim();
  }
  if (mode === "xff") {
    const v = req.headers.get("x-forwarded-for");
    if (v) return v.split(",")[0]!.trim();
  }
  return "local";
}

const DEVICE_ID = /^[A-Za-z0-9_-]{16,64}$/;

/**
 * The guest's device id: a random value the widget keeps in local storage and sends
 * as `x-pyt-device`. Guests are cookieless so the widget works inside a third-party
 * iframe. Missing or malformed ids fall back to IP plus user agent.
 */
export function deviceHash(req: Request): string {
  const raw = req.headers.get("x-pyt-device");
  if (raw && DEVICE_ID.test(raw)) return hashIdentifier("device", raw);
  return hashIdentifier("device", `${clientIp(req)}|${req.headers.get("user-agent") ?? ""}`);
}

export function ipHash(req: Request): string {
  return hashIdentifier("ip", clientIp(req));
}

/**
 * CSRF defense for every state-changing request: the browser-set Origin (or
 * Sec-Fetch-Site) must say the request came from our own pages.
 */
export function isSameOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (origin) {
    const allowed = new Set([new URL(env().APP_URL).origin, new URL(req.url).origin]);
    return allowed.has(origin);
  }
  return req.headers.get("sec-fetch-site") === "same-origin";
}
