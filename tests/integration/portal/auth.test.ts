import { and, desc, eq, gt } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { POST as redeemRoute } from "@/app/api/portal/auth/redeem/route";
import { POST as requestRoute } from "@/app/api/portal/auth/request/route";
import { POST as signOutRoute } from "@/app/api/portal/auth/sign-out/route";
import { GET as meRoute } from "@/app/api/portal/me/route";
import { db } from "@/db/client";
import { emailMessage, magicLink, operator } from "@/db/schema";
import { issueMagicLink, sessionCookieName } from "@/lib/auth/session";
import { resetEnvCache } from "@/lib/env";
import { inspectSignInLink } from "@/lib/portal/auth";
import { holdBackgroundWork, settleBackgroundWork } from "@/lib/portal/background";
import { sha256 } from "@/lib/security/crypto";
import { call, errorCode, HALCYON_HOST, HALCYON_OWNER, ORCHARD_HOST, request } from "./helpers";

async function linksFor(email: string): Promise<number> {
  const [op] = await db().select({ id: operator.id }).from(operator).where(eq(operator.email, email));
  if (!op) return 0;
  return (await db().select().from(magicLink).where(eq(magicLink.operatorId, op.id))).length;
}

async function latestMail(to: string, since: Date) {
  const [row] = await db()
    .select()
    .from(emailMessage)
    .where(and(eq(emailMessage.to, to), gt(emailMessage.createdAt, since)))
    .orderBy(desc(emailMessage.createdAt))
    .limit(1);
  return row;
}

const headerNames = (r: Response) => [...r.headers.keys()].filter((k) => k !== "x-request-id").sort();

// The limits below are the production ones, whatever a developer's environment scales them to.
const scale = process.env.RATE_LIMIT_SCALE;
beforeAll(() => {
  process.env.RATE_LIMIT_SCALE = "1";
  resetEnvCache();
});
afterAll(() => {
  if (scale === undefined) delete process.env.RATE_LIMIT_SCALE;
  else process.env.RATE_LIMIT_SCALE = scale;
  resetEnvCache();
});

describe("magic-link sign-in", () => {
  it("answers the same for a known and an unknown email, and only the known one gets a link", async () => {
    const since = new Date(Date.now() - 1000);
    const knownBefore = await linksFor(HALCYON_HOST);

    holdBackgroundWork();
    const known = await call(requestRoute, request("POST", "/api/portal/auth/request", { body: { email: HALCYON_HOST } }));
    // The lookup and the email run after the response: at answer time no link exists yet.
    expect(await linksFor(HALCYON_HOST)).toBe(knownBefore);
    const unknown = await call(
      requestRoute,
      request("POST", "/api/portal/auth/request", { body: { email: "nobody@halcyon.example" } }),
    );

    expect(known.status).toBe(200);
    expect(unknown.status).toBe(200);
    expect(known.body).toEqual({ ok: true });
    expect(unknown.body).toEqual(known.body);
    expect(headerNames(unknown.res)).toEqual(headerNames(known.res));

    await settleBackgroundWork();
    expect(await linksFor(HALCYON_HOST)).toBe(knownBefore + 1);
    expect(await latestMail("nobody@halcyon.example", since)).toBeUndefined();

    const mail = await latestMail(HALCYON_HOST, since);
    expect(mail?.subject).toBe("Sign in to Halcyon");
    expect(mail?.tag).toBe("portal-sign-in");
    expect(mail?.html).toContain("Sign in to Halcyon");
    expect(mail?.html).toContain("valid for 15 minutes");
    expect(mail?.text).toContain("valid for 15 minutes");
    expect(mail?.text).toContain("http://localhost:3000/portal/auth?token=");
    expect(mail?.html).not.toMatch(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u);
  });

  it("normalizes the address, so a different case still reaches the operator", async () => {
    const before = await linksFor(ORCHARD_HOST);
    const r = await call(
      requestRoute,
      request("POST", "/api/portal/auth/request", { body: { email: "HOST@Orchard-Room.example" } }),
    );
    expect(r.status).toBe(200);
    await settleBackgroundWork();
    expect(await linksFor(ORCHARD_HOST)).toBe(before + 1);
  });

  it("limits requests per email the same way for known and unknown addresses", async () => {
    for (const email of ["limit-test@halcyon.example", "owner@orchard-room.example"]) {
      const statuses: number[] = [];
      for (let i = 0; i < 4; i++) {
        statuses.push((await call(requestRoute, request("POST", "/api/portal/auth/request", { body: { email } }))).status);
      }
      expect(statuses).toEqual([200, 200, 200, 429]);
    }
    await settleBackgroundWork();
  });

  it("limits requests per IP", async () => {
    const ip = "198.51.100.77";
    const statuses: number[] = [];
    for (let i = 0; i < 11; i++) {
      const r = await call(
        requestRoute,
        request("POST", "/api/portal/auth/request", { ip, body: { email: `ip-${i}@unknown.example` } }),
      );
      statuses.push(r.status);
    }
    expect(statuses.slice(0, 10).every((s) => s === 200)).toBe(true);
    expect(statuses[10]).toBe(429);
    await settleBackgroundWork();
  });

  it("works once: the first POST signs in, the second is refused", async () => {
    const issued = await issueMagicLink(HALCYON_OWNER);
    const first = await call(redeemRoute, request("POST", "/api/portal/auth/redeem", { body: { token: issued!.token } }));
    expect(first.status).toBe(200);
    expect(first.body).toEqual({ ok: true, next: "/portal/tonight" });

    const cookie = first.res.headers.get("set-cookie") ?? "";
    expect(cookie.startsWith(`${sessionCookieName()}=`)).toBe(true);
    expect(sessionCookieName()).toBe("__Host-pyt_session");
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/Secure/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    expect(cookie).toMatch(/Path=\//i);
    expect(cookie).not.toMatch(/Domain=/i);

    const again = await call(redeemRoute, request("POST", "/api/portal/auth/redeem", { body: { token: issued!.token } }));
    expect(again.status).toBe(410);
    expect(errorCode(again)).toBe("link_expired");
    expect(await inspectSignInLink(issued!.token)).toMatchObject({ state: "used" });
  });

  it("refuses an expired link", async () => {
    const issued = await issueMagicLink(HALCYON_OWNER);
    await db()
      .update(magicLink)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(magicLink.tokenHash, sha256(issued!.token)));
    expect(await inspectSignInLink(issued!.token)).toMatchObject({ state: "expired", venueName: "Halcyon" });
    const r = await call(redeemRoute, request("POST", "/api/portal/auth/redeem", { body: { token: issued!.token } }));
    expect(r.status).toBe(410);
    expect(r.res.headers.get("set-cookie")).toBeNull();
  });

  it("never redeems on GET: opening the link leaves it usable", async () => {
    const issued = await issueMagicLink(HALCYON_OWNER);
    // The route has no GET handler at all; the page only reads the link's state.
    expect(await import("@/app/api/portal/auth/redeem/route")).not.toHaveProperty("GET");
    expect(await inspectSignInLink(issued!.token)).toMatchObject({ state: "valid", email: HALCYON_OWNER });
    expect(await inspectSignInLink(issued!.token)).toMatchObject({ state: "valid" });
    const [row] = await db()
      .select()
      .from(magicLink)
      .where(eq(magicLink.tokenHash, sha256(issued!.token)));
    expect(row?.usedAt).toBeNull();
    const r = await call(redeemRoute, request("POST", "/api/portal/auth/redeem", { body: { token: issued!.token } }));
    expect(r.status).toBe(200);
  });

  it("accepts a plain form post and redirects to Tonight", async () => {
    const issued = await issueMagicLink(HALCYON_HOST);
    const r = await call(redeemRoute, request("POST", "/api/portal/auth/redeem", { form: { token: issued!.token } }));
    expect(r.status).toBe(303);
    expect(r.res.headers.get("location")).toBe("http://localhost:3000/portal/tonight");
    expect(r.res.headers.get("set-cookie")).toMatch(/^__Host-pyt_session=/);

    const bad = await call(redeemRoute, request("POST", "/api/portal/auth/redeem", { form: { token: issued!.token } }));
    expect(bad.status).toBe(303);
    expect(bad.res.headers.get("location")).toBe("http://localhost:3000/portal/sign-in?link=expired");
  });

  it("sign-out revokes the session and clears the cookie", async () => {
    const issued = await issueMagicLink(HALCYON_HOST);
    const signedIn = await call(redeemRoute, request("POST", "/api/portal/auth/redeem", { body: { token: issued!.token } }));
    const cookie = signedIn.res.headers.get("set-cookie")!.split(";")[0]!;

    const me = await call(meRoute, request("GET", "/api/portal/me", { cookie }));
    expect(me.status).toBe(200);
    expect(me.body).toMatchObject({ operator: { email: HALCYON_HOST, role: "host" }, venue: { id: "halcyon" } });

    const out = await call(signOutRoute, request("POST", "/api/portal/auth/sign-out", { cookie }));
    expect(out.status).toBe(200);
    const cleared = out.res.headers.get("set-cookie") ?? "";
    expect(cleared).toMatch(/^__Host-pyt_session=;/);
    expect(cleared).toMatch(/Max-Age=0|Expires=Thu, 01 Jan 1970/i);
    expect(cleared).toMatch(/Secure/i);

    const after = await call(meRoute, request("GET", "/api/portal/me", { cookie }));
    expect(after.status).toBe(401);
    expect(errorCode(after)).toBe("signed_out");
  });

  it("answers a plain form post the same way for known and unknown emails", async () => {
    const known = await call(requestRoute, request("POST", "/api/portal/auth/request", { form: { email: ` ${ORCHARD_HOST} ` } }));
    const unknown = await call(
      requestRoute,
      request("POST", "/api/portal/auth/request", { form: { email: "someone@orchard-room.example" } }),
    );
    for (const r of [known, unknown]) {
      expect(r.status).toBe(303);
      expect(r.res.headers.get("location")).toBe("http://localhost:3000/portal/sign-in?sent=1");
    }
    const bad = await call(requestRoute, request("POST", "/api/portal/auth/request", { form: { email: "not an email" } }));
    expect(bad.res.headers.get("location")).toBe("http://localhost:3000/portal/sign-in?invalid=1");
    await settleBackgroundWork();
  });

  it("rejects a sign-in request from another site", async () => {
    const r = await call(
      requestRoute,
      request("POST", "/api/portal/auth/request", { origin: "https://evil.example", body: { email: HALCYON_OWNER } }),
    );
    expect(r.status).toBe(403);
    expect(errorCode(r)).toBe("cross_origin");
  });
});
