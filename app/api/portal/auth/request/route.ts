import { signInRequestBody } from "@/lib/api/contracts";
import { normalizeEmail } from "@/lib/auth/session";
import { api, tooMany } from "@/lib/http/api";
import { sendSignInLink } from "@/lib/portal/auth";
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
 */
export const POST = api({ body: signInRequestBody }, async ({ req, body }) => {
  const email = normalizeEmail(body.email);
  const [byIp, byEmail] = await Promise.all([
    rateLimit("magicLinkIp", ipHash(req), LIMITS.magicLinkIp),
    rateLimit("magicLinkEmail", hashIdentifier("email", email), LIMITS.magicLinkEmail),
  ]);
  const limited = [byIp, byEmail].find((r) => !r.ok);
  if (limited) throw tooMany(limited.retryAfterSeconds, "Too many sign-in requests. Wait a few minutes, then try again.");
  runAfterResponse("portal.sign_in_link", () => sendSignInLink(email));
  return { ok: true as const };
});
