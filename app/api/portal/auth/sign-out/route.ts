import { NextResponse } from "next/server";
import { revokeSession, sessionCookieName, sessionCookieOptions } from "@/lib/auth/session";
import { api } from "@/lib/http/api";
import { log } from "@/lib/log";
import { SIGN_IN_PATH } from "@/lib/portal/auth";

export const dynamic = "force-dynamic";

/** Ends the session on the server and clears the cookie. A plain form post gets a redirect to sign-in. */
export const POST = api({}, async ({ req }) => {
  const name = sessionCookieName();
  await revokeSession(req.cookies.get(name)?.value);
  log.info("portal.signed_out", {});
  const isForm = (req.headers.get("content-type") ?? "").toLowerCase().startsWith("application/x-www-form-urlencoded");
  const res = isForm ? NextResponse.redirect(new URL(SIGN_IN_PATH, req.url), 303) : NextResponse.json({ ok: true as const });
  res.cookies.set(name, "", { ...sessionCookieOptions(new Date(0)), maxAge: 0 });
  return res;
});
