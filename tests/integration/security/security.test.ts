import { SignJWT } from "jose";
import { NextRequest } from "next/server";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { closeDb, db } from "@/db/client";
import { featureFlag, magicLink, operator } from "@/db/schema";
import { issueMagicLink, redeemMagicLink, sessionCookieName, sessionCookieOptions } from "@/lib/auth/session";
import { env, resetEnvCache } from "@/lib/env";
import { clearFlagCache } from "@/lib/flags";
import { api } from "@/lib/http/api";
import { logPath, maskEmail } from "@/lib/log";
import { derivedKey, hashIdentifier, safeEqual } from "@/lib/security/crypto";
import { rateLimit } from "@/lib/security/rate-limit";
import { clientIp, deviceHash, isSameOrigin } from "@/lib/security/request";
import { signToken, verifyToken } from "@/lib/security/tokens";
import { verifyTurnstile } from "@/lib/security/turnstile";
import { eq } from "drizzle-orm";

const ORIGIN = "http://localhost:3000";
const route = { params: Promise.resolve({}) };

function req(url: string, init: { method?: string; headers?: Record<string, string>; body?: string } = {}) {
  return new NextRequest(new URL(url, ORIGIN), { method: init.method ?? "GET", headers: init.headers, body: init.body });
}

afterAll(async () => {
  await closeDb();
});

/** The environment's validation errors, or "" when it is valid. */
function envIssues(): string {
  resetEnvCache();
  try {
    env();
    return "";
  } catch (e) {
    return (e as Error).message;
  }
}

describe("signed tokens", () => {
  it("round-trips and binds purpose, subject and nonce", async () => {
    const t = await signToken("manage", { sub: "r1", nonce: "n1", expiresAt: new Date(Date.now() + 60_000) });
    const v = await verifyToken("manage", t);
    expect(v).toEqual({ ok: true, claims: expect.objectContaining({ sub: "r1", nonce: "n1" }) });
  });

  it("refuses a token for another purpose", async () => {
    const t = await signToken("hold", { sub: "r1", expiresAt: new Date(Date.now() + 60_000) });
    expect(await verifyToken("manage", t)).toEqual({ ok: false, reason: "invalid" });
  });

  it("refuses tampered, expired, unsigned and garbage tokens", async () => {
    const t = await signToken("manage", { sub: "r1", nonce: "n1", expiresAt: new Date(Date.now() + 60_000) });
    const [h, p, s] = t.split(".") as [string, string, string];
    const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(p, "base64url").toString()), sub: "r2" })).toString(
      "base64url",
    );
    expect((await verifyToken("manage", `${h}.${forged}.${s}`)).ok).toBe(false);

    const expired = await signToken("manage", { sub: "r1", expiresAt: new Date(Date.now() - 1000) });
    expect(await verifyToken("manage", expired)).toEqual({ ok: false, reason: "expired" });

    const none = `${Buffer.from('{"alg":"none"}').toString("base64url")}.${p}.`;
    expect((await verifyToken("manage", none)).ok).toBe(false);

    // Signed with a different key (as an attacker without APP_SECRET would).
    const other = await new SignJWT({ nonce: "n1" })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuer("pyt")
      .setAudience("manage")
      .setSubject("r1")
      .setExpirationTime("1h")
      .sign(new TextEncoder().encode("attacker-key-attacker-key-attacker-key"));
    expect((await verifyToken("manage", other)).ok).toBe(false);

    expect((await verifyToken("manage", "not-a-token")).ok).toBe(false);
    expect((await verifyToken("manage", "a".repeat(5000))).ok).toBe(false);
  });

  it("derives a different key for every purpose", () => {
    expect(derivedKey("token-manage").equals(derivedKey("token-hold"))).toBe(false);
    expect(hashIdentifier("ip", "1.2.3.4")).not.toBe(hashIdentifier("device", "1.2.3.4"));
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "abcd")).toBe(false);
  });
});

describe("request identity and CSRF", () => {
  it("accepts same-origin and refuses cross-site requests", () => {
    expect(isSameOrigin(req("/x", { method: "POST", headers: { origin: ORIGIN } }))).toBe(true);
    expect(isSameOrigin(req("/x", { method: "POST", headers: { origin: "https://evil.example" } }))).toBe(false);
    expect(isSameOrigin(req("/x", { method: "POST", headers: { "sec-fetch-site": "same-origin" } }))).toBe(true);
    expect(isSameOrigin(req("/x", { method: "POST", headers: { "sec-fetch-site": "cross-site" } }))).toBe(false);
    expect(isSameOrigin(req("/x", { method: "POST" }))).toBe(false);
  });

  it("trusts only the configured client IP header, and only its last hop", () => {
    // The proxy appends the address it saw; anything before it came from the client.
    expect(clientIp(req("/x", { headers: { "x-forwarded-for": "198.51.100.66, 203.0.113.9" } }))).toBe("203.0.113.9");
    expect(clientIp(req("/x", { headers: { "x-forwarded-for": "203.0.113.9" } }))).toBe("203.0.113.9");
    process.env.TRUST_PROXY = "none";
    resetEnvCache();
    expect(clientIp(req("/x", { headers: { "x-forwarded-for": "203.0.113.9" } }))).toBe("local");
    process.env.TRUST_PROXY = "xff";
    resetEnvCache();
  });

  it("hashes device ids and falls back for malformed ones", () => {
    const a = deviceHash(req("/x", { headers: { "x-pyt-device": "AbCdEfGhIjKlMnOpQrSt" } }));
    const b = deviceHash(req("/x", { headers: { "x-pyt-device": "AbCdEfGhIjKlMnOpQrSt" } }));
    const bad = deviceHash(req("/x", { headers: { "x-pyt-device": "<script>" } }));
    expect(a).toBe(b);
    expect(a).not.toContain("AbCd");
    expect(bad).toHaveLength(32);
  });
});

describe("api() wrapper", () => {
  const body = z.object({ name: z.string().min(1) });
  const handler = api({ body }, async ({ body: b }) => ({ hello: b.name }));
  const guest = api({ guest: true }, async () => ({ ok: true }));

  it("refuses cross-origin mutations", async () => {
    const r = await handler(
      req("/x", {
        method: "POST",
        headers: { origin: "https://evil.example", "content-type": "application/json" },
        body: '{"name":"a"}',
      }),
      route,
    );
    expect(r.status).toBe(403);
    expect((await r.json()).error.code).toBe("cross_origin");
  });

  it("requires JSON, caps the body and validates it", async () => {
    const h = { origin: ORIGIN };
    expect(
      (await handler(req("/x", { method: "POST", headers: { ...h, "content-type": "text/plain" }, body: "name=a" }), route))
        .status,
    ).toBe(415);
    expect(
      (
        await handler(
          req("/x", {
            method: "POST",
            headers: { ...h, "content-type": "application/json" },
            body: JSON.stringify({ name: "a".repeat(20_000) }),
          }),
          route,
        )
      ).status,
    ).toBe(413);
    expect(
      (await handler(req("/x", { method: "POST", headers: { ...h, "content-type": "application/json" }, body: "{oops" }), route))
        .status,
    ).toBe(400);
    const invalid = await handler(
      req("/x", { method: "POST", headers: { ...h, "content-type": "application/json" }, body: '{"name":""}' }),
      route,
    );
    expect(invalid.status).toBe(400);
    expect((await invalid.json()).error.code).toBe("invalid_request");
    const ok = await handler(
      req("/x", { method: "POST", headers: { ...h, "content-type": "application/json" }, body: '{"name":"Ada","price":1}' }),
      route,
    );
    expect(await ok.json()).toEqual({ hello: "Ada" });
    expect(ok.headers.get("cache-control")).toBe("no-store");
  });

  it("guest routes stop when the kill switch is off", async () => {
    await db().update(featureFlag).set({ enabled: false }).where(eq(featureFlag.key, "pyt_widget_enabled"));
    clearFlagCache();
    const r = await guest(req("/x"), route);
    expect(r.status).toBe(503);
    expect((await r.json()).error.code).toBe("widget_disabled");
    await db().update(featureFlag).set({ enabled: true }).where(eq(featureFlag.key, "pyt_widget_enabled"));
    clearFlagCache();
    expect((await guest(req("/x"), route)).status).toBe(200);
  });

  it("hides internal errors", async () => {
    const boom = api({}, async () => {
      throw new Error("db password is hunter2");
    });
    const r = await boom(req("/x"), route);
    expect(r.status).toBe(500);
    expect(JSON.stringify(await r.json())).not.toContain("hunter2");
  });
});

describe("rate limits", () => {
  it("allows up to the limit in a window, then refuses", async () => {
    const id = `test-${Date.now()}`;
    const limit = { limit: 3, windowSeconds: 60 };
    const results = [];
    for (let i = 0; i < 5; i++) results.push(await rateLimit("unit", id, limit));
    expect(results.map((r) => r.ok)).toEqual([true, true, true, false, false]);
    expect(results[4]!.retryAfterSeconds).toBeGreaterThan(0);
  });
});

describe("magic links", () => {
  beforeEach(async () => {
    await db().delete(magicLink);
  });

  it("works once, is stored hashed and does not exist for unknown emails", async () => {
    expect(await issueMagicLink("nobody@example.com")).toBeNull();
    const issued = await issueMagicLink("  OWNER@halcyon.example ");
    expect(issued).not.toBeNull();
    const rows = await db().select().from(magicLink);
    expect(rows[0]!.tokenHash).not.toBe(issued!.token);
    const first = await redeemMagicLink(issued!.token);
    expect(first?.sessionToken).toMatch(/^[\w-]{43}$/);
    expect(await redeemMagicLink(issued!.token)).toBeNull();
  });

  it("expires after 15 minutes and refuses malformed tokens", async () => {
    const issued = await issueMagicLink("host@halcyon.example");
    await db()
      .update(magicLink)
      .set({ expiresAt: new Date(Date.now() - 1000) });
    expect(await redeemMagicLink(issued!.token)).toBeNull();
    expect(await redeemMagicLink("'; drop table operator; --")).toBeNull();
  });

  it("refuses disabled operators", async () => {
    const issued = await issueMagicLink("host@halcyon.example");
    await db().update(operator).set({ disabledAt: new Date() }).where(eq(operator.email, "host@halcyon.example"));
    expect(await redeemMagicLink(issued!.token)).toBeNull();
    await db().update(operator).set({ disabledAt: null }).where(eq(operator.email, "host@halcyon.example"));
  });

  it("uses a __Host- HttpOnly, Secure, SameSite=Lax session cookie", () => {
    expect(sessionCookieName()).toBe("__Host-pyt_session");
    expect(sessionCookieOptions(new Date())).toMatchObject({ httpOnly: true, secure: true, sameSite: "lax", path: "/" });
  });
});

describe("environment and logs", () => {
  it("refuses live Stripe keys", () => {
    process.env.STRIPE_SECRET_KEY = "sk_live_123";
    resetEnvCache();
    expect(() => env()).toThrow(/test-mode keys only/);
    delete process.env.STRIPE_SECRET_KEY;
    resetEnvCache();
    expect(env().PAYMENTS_MODE).toBe("sim");
  });

  it("refuses unsafe defaults in production unless it is a test deployment", () => {
    const vars = process.env as Record<string, string | undefined>;
    const saved = { ...vars };
    try {
      vars.NODE_ENV = "production";
      vars.TRUST_PROXY = "none";
      vars.RATE_LIMIT_SCALE = "5";
      vars.TURNSTILE_SECRET_KEY = "1x0000000000000000000000000000000AA";
      const refused = envIssues();
      expect(refused).toMatch(/TRUST_PROXY/);
      expect(refused).toMatch(/TURNSTILE_SECRET_KEY: Turnstile test keys always pass/);
      expect(refused).toMatch(/RATE_LIMIT_SCALE: must be 1 in production/);
      // A test build may use test keys and scaled limits, but never one shared IP bucket.
      vars.PYT_TEST_DEPLOYMENT = "1";
      expect(envIssues()).toMatch(/TRUST_PROXY/);
      expect(envIssues()).not.toMatch(/TURNSTILE|RATE_LIMIT/);
      vars.TRUST_PROXY = "vercel";
      expect(envIssues()).toBe("");
    } finally {
      for (const k of Object.keys(vars)) if (!(k in saved)) delete vars[k];
      Object.assign(vars, saved);
      resetEnvCache();
    }
  });

  it("masks emails in log lines, and cuts manage tokens out of logged paths", () => {
    expect(maskEmail("guest jane.doe@example.com paid")).toBe("guest j***@example.com paid");
    expect(logPath("/api/manage/eyJhbGciOi.abc.def/cancel")).toBe("/api/manage/:token/cancel");
    expect(logPath("/v/halcyon/manage/eyJhbGciOi.abc.def")).toBe("/v/halcyon/manage/:token");
    expect(logPath("/api/holds/0190")).toBe("/api/holds/0190");
  });

  it("verifies Turnstile with the documented test secrets", async () => {
    expect(await verifyTurnstile("XXXX.DUMMY.TOKEN.XXXX", "203.0.113.1")).toEqual({ ok: true });
    expect(await verifyTurnstile(undefined, "203.0.113.1")).toEqual({ ok: false, reason: "missing" });
    process.env.TURNSTILE_SECRET_KEY = "2x0000000000000000000000000000000AA";
    resetEnvCache();
    expect(await verifyTurnstile("XXXX.DUMMY.TOKEN.XXXX", "203.0.113.1")).toEqual({ ok: false, reason: "failed" });
    process.env.TURNSTILE_SECRET_KEY = "1x0000000000000000000000000000000AA";
    resetEnvCache();
  });
});

describe("email sender", () => {
  it("shows the venue's name as the sender, never ours", async () => {
    const { fromHeader } = await import("@/lib/email/index");
    expect(fromHeader("bookings@pyt.example", "Halcyon")).toBe('"Halcyon" <bookings@pyt.example>');
    expect(fromHeader("Ops <bookings@pyt.example>", "The Orchard Room")).toBe('"The Orchard Room" <bookings@pyt.example>');
    expect(fromHeader("bookings@pyt.example", 'Evil"\r\nBcc: x@y.z')).toBe('"EvilBcc: x@y.z" <bookings@pyt.example>');
  });
});
