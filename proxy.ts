import { type NextRequest, NextResponse } from "next/server";

/**
 * Per-request Content Security Policy with a fresh nonce (Next.js attaches it to its
 * own scripts). This layer only sets headers. It is never the authorization gate:
 * every route handler checks access itself.
 *
 * Third-party script origins are limited to Stripe and Turnstile (PRD privacy
 * controls). Only the guest widget may be framed, for the venue-site embed.
 */

const isDev = process.env.NODE_ENV !== "production";
const isHttps = (process.env.APP_URL ?? "").startsWith("https://");

function frameAncestors(pathname: string): string {
  if (pathname.startsWith("/v/") && !pathname.includes("/manage/")) {
    const extra = (process.env.EMBED_ALLOWED_ORIGINS ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter((s) => /^https:\/\/[a-z0-9.-]+(:\d+)?$/i.test(s));
    return ["'self'", ...extra].join(" ");
  }
  return "'none'";
}

export function proxy(request: NextRequest) {
  const nonce = btoa(crypto.randomUUID());
  const { pathname } = request.nextUrl;

  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' 'wasm-unsafe-eval' https://js.stripe.com https://challenges.cloudflare.com${isDev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https://*.stripe.com",
    "font-src 'self'",
    `connect-src 'self' https://api.stripe.com https://challenges.cloudflare.com${isDev ? " ws: wss:" : ""}`,
    // The demo venue site stands in for a third-party page that frames our widget.
    `frame-src ${pathname.startsWith("/demo/") ? "'self' " : ""}https://js.stripe.com https://*.js.stripe.com https://hooks.stripe.com https://challenges.cloudflare.com`,
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    `frame-ancestors ${frameAncestors(pathname)}`,
    ...(isHttps ? ["upgrade-insecure-requests"] : []),
  ].join("; ");

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("content-security-policy", csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("content-security-policy", csp);
  if (frameAncestors(pathname) === "'none'") response.headers.set("x-frame-options", "DENY");
  // Manage links carry a token in the path: never leak it in a Referer header.
  if (pathname.includes("/manage/")) response.headers.set("referrer-policy", "no-referrer");
  return response;
}

export const config = {
  matcher: [
    {
      source: "/((?!_next/static|_next/image|favicon.ico|icon.svg|venues/|fonts/|embed.js|robots.txt).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
