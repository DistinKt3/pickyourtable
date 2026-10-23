import { NextResponse } from "next/server";
import { signInRedeemBody } from "@/lib/api/contracts";
import { redeemMagicLink, sessionCookieName, sessionCookieOptions } from "@/lib/auth/session";
import { ApiError, api, tooMany } from "@/lib/http/api";
import { log } from "@/lib/log";
import { HOME_PATH } from "@/lib/portal/auth";
import { LIMITS, rateLimit } from "@/lib/security/rate-limit";
import { ipHash } from "@/lib/security/request";

export const dynamic = "force-dynamic";

/**
 * Redeems a sign-in link. Only a POST can use a link (the Sign in button on
 * /portal/auth), never the GET that opens the page, so mail scanners that prefetch
 * links cannot spend them. Takes JSON from the page script, or a plain form post when
 * scripts are off: the form gets a redirect, JSON gets `{ ok, next }`.
 */
export const POST = api({}, async ({ req }) => {
  const type = (req.headers.get("content-type") ?? "").toLowerCase();
  const isForm = type.startsWith("application/x-www-form-urlencoded");
  if (!isForm && !type.startsWith("application/json")) throw new ApiError(415, "unsupported_media_type", "Send JSON.");
  const text = await req.text();
  if (text.length > 2048) throw new ApiError(413, "too_large", "Request is too large.");
  let raw: unknown;
  try {
    raw = isForm ? Object.fromEntries(new URLSearchParams(text)) : JSON.parse(text || "{}");
  } catch {
    throw new ApiError(400, "invalid_json", "Request body is not valid JSON.");
  }

  const limit = await rateLimit("magicLinkRedeem", ipHash(req), LIMITS.magicLinkIp);
  if (!limit.ok) throw tooMany(limit.retryAfterSeconds);

  const parsed = signInRedeemBody.safeParse(raw);
  const session = parsed.success ? await redeemMagicLink(parsed.data.token) : null;
  if (!session) {
    log.info("portal.sign_in_failed", { reason: "link_unusable" });
    if (isForm) return NextResponse.redirect(new URL("/portal/sign-in?link=expired", req.url), 303);
    throw new ApiError(410, "link_expired", "This sign-in link has expired or has already been used. Ask for a new one.");
  }

  log.info("portal.signed_in", { operatorId: session.operatorId });
  const res = isForm
    ? NextResponse.redirect(new URL(HOME_PATH, req.url), 303)
    : NextResponse.json({ ok: true as const, next: HOME_PATH });
  res.cookies.set(sessionCookieName(), session.sessionToken, sessionCookieOptions(session.expiresAt));
  return res;
});
