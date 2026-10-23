import { NextResponse } from "next/server";
import { signInRequestBody } from "@/lib/api/contracts";
import { normalizeEmail } from "@/lib/auth/session";
import { ApiError, api, tooMany } from "@/lib/http/api";
import { SIGN_IN_PATH, sendSignInLink } from "@/lib/portal/auth";
import { runAfterResponse } from "@/lib/portal/background";
import { hashIdentifier } from "@/lib/security/crypto";
import { LIMITS, rateLimit } from "@/lib/security/rate-limit";
import { ipHash } from "@/lib/security/request";

export const dynamic = "force-dynamic";

/**
 * Asks for a sign-in link. The answer is always `{ ok: true }`, and it takes the same
 * time whether or not the email has an account: the lookup and the email happen
 * after the response, so nobody can learn which addresses belong to operators.
 * Limits count every address the same way, known or not.
 *
 * Takes JSON from the page script, or a plain form post when scripts have not loaded
 * yet; the form gets a redirect back to sign-in with the same neutral answer.
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
  if (isForm && raw && typeof raw === "object" && "email" in raw && typeof raw.email === "string") {
    raw = { email: raw.email.trim() };
  }
  const body = signInRequestBody.safeParse(raw);
  if (!body.success) {
    if (isForm) return NextResponse.redirect(new URL(`${SIGN_IN_PATH}?invalid=1`, req.url), 303);
    throw body.error;
  }

  const email = normalizeEmail(body.data.email);
  const [byIp, byEmail] = await Promise.all([
    rateLimit("magicLinkIp", ipHash(req), LIMITS.magicLinkIp),
    rateLimit("magicLinkEmail", hashIdentifier("email", email), LIMITS.magicLinkEmail),
  ]);
  const limited = [byIp, byEmail].find((r) => !r.ok);
  if (limited) {
    if (isForm) return NextResponse.redirect(new URL(`${SIGN_IN_PATH}?limited=1`, req.url), 303);
    throw tooMany(limited.retryAfterSeconds, "Too many sign-in requests. Wait a few minutes, then try again.");
  }
  runAfterResponse("portal.sign_in_link", () => sendSignInLink(email));
  if (isForm) return NextResponse.redirect(new URL(`${SIGN_IN_PATH}?sent=1`, req.url), 303);
  return { ok: true as const };
});
