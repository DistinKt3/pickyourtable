import { beforeAll, describe, expect, it } from "vitest";
import { POST as createBlackoutRoute } from "@/app/api/portal/blackouts/route";
import { PUT as ruleRoute } from "@/app/api/portal/pricing/rules/route";
import { POST as seatRoute } from "@/app/api/portal/reservations/[id]/seat/route";
import { POST as signOutRoute } from "@/app/api/portal/auth/sign-out/route";
import { GET as meRoute } from "@/app/api/portal/me/route";
import { PATCH as tableRoute } from "@/app/api/portal/tables/[code]/route";
import { addDays, todayIn } from "@/lib/format";
import { call, errorCode, HALCYON_OWNER, request, signIn } from "./helpers";

let owner: string;
const SOME_ID = "0190a0a0-0000-7000-8000-000000000002";

beforeAll(async () => {
  owner = await signIn(HALCYON_OWNER);
});

describe("CSRF: portal mutations must come from the portal's own pages", () => {
  it("refuses a foreign Origin even with a valid session cookie", async () => {
    const evil = "https://evil.example";
    const results = await Promise.all([
      call(tableRoute, request("PATCH", "/api/portal/tables/W1", { cookie: owner, origin: evil, body: { bookable: false } }), {
        code: "W1",
      }),
      call(
        ruleRoute,
        request("PUT", "/api/portal/pricing/rules", {
          cookie: owner,
          origin: evil,
          body: { tier: "window", daypart: "dinner", dayType: "weeknight", feeCents: 1 },
        }),
      ),
      call(
        createBlackoutRoute,
        request("POST", "/api/portal/blackouts", {
          cookie: owner,
          origin: evil,
          body: { table: null, date: addDays(todayIn("America/Los_Angeles"), 4), from: "17:00", to: "23:59", reason: "Forged" },
        }),
      ),
      call(seatRoute, request("POST", `/api/portal/reservations/${SOME_ID}/seat`, { cookie: owner, origin: evil, body: {} }), {
        id: SOME_ID,
      }),
      call(signOutRoute, request("POST", "/api/portal/auth/sign-out", { cookie: owner, origin: evil })),
    ]);
    for (const r of results) {
      expect(r.status).toBe(403);
      expect(errorCode(r)).toBe("cross_origin");
    }
    // The forged sign-out did nothing.
    expect((await call(meRoute, request("GET", "/api/portal/me", { cookie: owner }))).status).toBe(200);
  });

  it("refuses a mutation with neither Origin nor Sec-Fetch-Site", async () => {
    const r = await call(
      tableRoute,
      request("PATCH", "/api/portal/tables/W1", { cookie: owner, origin: null, body: { bookable: false } }),
      { code: "W1" },
    );
    expect(r.status).toBe(403);
    expect(errorCode(r)).toBe("cross_origin");
  });
});
