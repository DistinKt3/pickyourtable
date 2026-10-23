import { and, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { DELETE as deleteBlackoutRoute } from "@/app/api/portal/blackouts/[id]/route";
import { GET as overlapsRoute } from "@/app/api/portal/blackouts/overlaps/route";
import { GET as blackoutsRoute, POST as createBlackoutRoute } from "@/app/api/portal/blackouts/route";
import { DELETE as deleteRuleRoute } from "@/app/api/portal/pricing/rules/[id]/route";
import { PUT as ruleRoute } from "@/app/api/portal/pricing/rules/route";
import { GET as pricingRoute } from "@/app/api/portal/pricing/route";
import { GET as historyRoute } from "@/app/api/portal/reservations/[id]/history/route";
import { POST as cancelRoute } from "@/app/api/portal/reservations/[id]/cancel/route";
import { POST as goLiveRoute } from "@/app/api/portal/review/go-live/route";
import { GET as reviewRoute } from "@/app/api/portal/review/route";
import { POST as approveRoute } from "@/app/api/portal/review/tables/[code]/route";
import { PATCH as tableRoute } from "@/app/api/portal/tables/[code]/route";
import { GET as tablesRoute } from "@/app/api/portal/tables/route";
import { PUT as turnTimesRoute } from "@/app/api/portal/turn-times/route";
import { db } from "@/db/client";
import { auditLog, blackout, priceRule, venueTable } from "@/db/schema";
import { addDays, todayIn } from "@/lib/format";
import { call, errorCode, HALCYON_HOST, HALCYON_OWNER, ORCHARD_OWNER, request, signIn } from "./helpers";

const SOME_ID = "0190a0a0-0000-7000-8000-000000000001";
const future = addDays(todayIn("America/Los_Angeles"), 5);

let host: string;
let owner: string;
let orchardOwner: string;

beforeAll(async () => {
  [host, owner, orchardOwner] = await Promise.all([signIn(HALCYON_HOST), signIn(HALCYON_OWNER), signIn(ORCHARD_OWNER)]);
});

describe("roles: a Host cannot reach Owner-only screens or move money", () => {
  const cases: [string, () => Promise<{ status: number; body: unknown }>][] = [
    ["GET tables", () => call(tablesRoute, request("GET", "/api/portal/tables", { cookie: host }))],
    [
      "PATCH a table",
      () =>
        call(tableRoute, request("PATCH", "/api/portal/tables/W1", { cookie: host, body: { bookable: false } }), { code: "W1" }),
    ],
    ["GET pricing", () => call(pricingRoute, request("GET", "/api/portal/pricing", { cookie: host }))],
    [
      "PUT a fee",
      () =>
        call(
          ruleRoute,
          request("PUT", "/api/portal/pricing/rules", {
            cookie: host,
            body: { tier: "window", daypart: "dinner", dayType: "weeknight", feeCents: 100 },
          }),
        ),
    ],
    [
      "DELETE a fee",
      () => call(deleteRuleRoute, request("DELETE", `/api/portal/pricing/rules/${SOME_ID}`, { cookie: host }), { id: SOME_ID }),
    ],
    [
      "PUT turn times",
      () =>
        call(
          turnTimesRoute,
          request("PUT", "/api/portal/turn-times", {
            cookie: host,
            body: { turnTimes: [{ minParty: 1, maxParty: 6, minutes: 90 }] },
          }),
        ),
    ],
    ["GET blackouts", () => call(blackoutsRoute, request("GET", "/api/portal/blackouts", { cookie: host }))],
    [
      "GET blackout overlaps",
      () =>
        call(
          overlapsRoute,
          request("GET", `/api/portal/blackouts/overlaps?date=${future}&from=17:00&to=18:00`, { cookie: host }),
        ),
    ],
    [
      "POST a blackout",
      () =>
        call(
          createBlackoutRoute,
          request("POST", "/api/portal/blackouts", {
            cookie: host,
            body: { table: "W1", date: future, from: "17:00", to: "18:00", reason: "Private event" },
          }),
        ),
    ],
    [
      "DELETE a blackout",
      () => call(deleteBlackoutRoute, request("DELETE", `/api/portal/blackouts/${SOME_ID}`, { cookie: host }), { id: SOME_ID }),
    ],
    ["GET review", () => call(reviewRoute, request("GET", "/api/portal/review", { cookie: host }))],
    [
      "approve a table",
      () =>
        call(approveRoute, request("POST", "/api/portal/review/tables/W1", { cookie: host, body: { approved: false } }), {
          code: "W1",
        }),
    ],
    ["go live", () => call(goLiveRoute, request("POST", "/api/portal/review/go-live", { cookie: host }))],
    [
      "cancel with refund",
      () =>
        call(
          cancelRoute,
          request("POST", `/api/portal/reservations/${SOME_ID}/cancel`, { cookie: host, body: { reason: "Kitchen closed" } }),
          { id: SOME_ID },
        ),
    ],
  ];

  for (const [name, run] of cases) {
    it(`${name}: 403`, async () => {
      const r = await run();
      expect(r.status).toBe(403);
      expect(errorCode(r as never)).toBe("forbidden");
    });
  }

  it("an Owner reaches the same screens", async () => {
    expect((await call(tablesRoute, request("GET", "/api/portal/tables", { cookie: owner }))).status).toBe(200);
    expect((await call(pricingRoute, request("GET", "/api/portal/pricing", { cookie: owner }))).status).toBe(200);
    expect((await call(blackoutsRoute, request("GET", "/api/portal/blackouts", { cookie: owner }))).status).toBe(200);
    expect((await call(reviewRoute, request("GET", "/api/portal/review", { cookie: owner }))).status).toBe(200);
  });

  it("signed-out requests get 401", async () => {
    const r = await call(tablesRoute, request("GET", "/api/portal/tables"));
    expect(r.status).toBe(401);
    expect(errorCode(r)).toBe("signed_out");
  });
});

describe("cross-venue: an Owner sees and changes only their own venue", () => {
  it("reads only their own tables, even where table codes match", async () => {
    const mine = await call<{ tables: { code: string; label: string }[] }>(
      tablesRoute,
      request("GET", "/api/portal/tables", { cookie: orchardOwner }),
    );
    expect(mine.status).toBe(200);
    const codes = mine.body.tables.map((t) => t.code);
    expect(codes).toContain("G1");
    expect(codes).not.toContain("W1");
    // S1 exists in both venues; Orchard's is Table 21.
    expect(mine.body.tables.find((t) => t.code === "S1")?.label).toBe("Table 21");
  });

  it("cannot change another venue's table: the same code changes only their own", async () => {
    const before = await db()
      .select({ attributes: venueTable.attributes })
      .from(venueTable)
      .where(and(eq(venueTable.venueId, "halcyon"), eq(venueTable.code, "S1")));
    const r = await call(
      tableRoute,
      request("PATCH", "/api/portal/tables/S1", { cookie: orchardOwner, body: { attributes: ["corner"] } }),
      { code: "S1" },
    );
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ table: { code: "S1", label: "Table 21", attributes: ["corner"] } });
    const after = await db()
      .select({ attributes: venueTable.attributes })
      .from(venueTable)
      .where(and(eq(venueTable.venueId, "halcyon"), eq(venueTable.code, "S1")));
    expect(after).toEqual(before);

    const w1 = await call(
      tableRoute,
      request("PATCH", "/api/portal/tables/W1", { cookie: orchardOwner, body: { bookable: false } }),
      { code: "W1" },
    );
    expect(w1.status).toBe(404);
  });

  it("cannot delete another venue's fee or blackout", async () => {
    const [rule] = await db()
      .insert(priceRule)
      .values({ venueId: "halcyon", tier: "window", daypart: "dinner", dayType: "special", specialDate: future, feeCents: 6000 })
      .returning();
    const delRule = await call(
      deleteRuleRoute,
      request("DELETE", `/api/portal/pricing/rules/${rule!.id}`, { cookie: orchardOwner }),
      { id: rule!.id },
    );
    expect(delRule.status).toBe(404);
    expect(await db().select().from(priceRule).where(eq(priceRule.id, rule!.id))).toHaveLength(1);

    const created = await call<{ blackout: { id: string } }>(
      createBlackoutRoute,
      request("POST", "/api/portal/blackouts", {
        cookie: owner,
        body: { table: "W2", date: future, from: "12:00", to: "13:00", reason: "Window cleaning" },
      }),
    );
    expect(created.status).toBe(201);
    const id = created.body.blackout.id;
    const del = await call(deleteBlackoutRoute, request("DELETE", `/api/portal/blackouts/${id}`, { cookie: orchardOwner }), {
      id,
    });
    expect(del.status).toBe(404);
    expect(await db().select().from(blackout).where(eq(blackout.id, id))).toHaveLength(1);

    const theirs = await call<{ blackouts: { id: string }[] }>(
      blackoutsRoute,
      request("GET", "/api/portal/blackouts", { cookie: orchardOwner }),
    );
    expect(theirs.body.blackouts.map((b) => b.id)).not.toContain(id);

    // Leave no fee or blackout behind for other test files on the same date.
    await db().delete(priceRule).where(eq(priceRule.id, rule!.id));
    await db().delete(blackout).where(eq(blackout.id, id));
  });

  it("cannot block another venue's table or read another venue's review or history", async () => {
    const r = await call(
      createBlackoutRoute,
      request("POST", "/api/portal/blackouts", {
        cookie: orchardOwner,
        body: { table: "W1", date: future, from: "17:00", to: "18:00", reason: "Not mine" },
      }),
    );
    expect(r.status).toBe(404);

    const review = await call<{ tables: { code: string }[] }>(
      reviewRoute,
      request("GET", "/api/portal/review", { cookie: orchardOwner }),
    );
    expect(review.body.tables.map((t) => t.code)).not.toContain("W1");

    const approve = await call(
      approveRoute,
      request("POST", "/api/portal/review/tables/W1", { cookie: orchardOwner, body: { approved: false } }),
      { code: "W1" },
    );
    expect(approve.status).toBe(404);

    await db().insert(auditLog).values({
      venueId: "halcyon",
      actorType: "operator",
      actorId: null,
      action: "reservation.refunded",
      reservationId: SOME_ID,
      amountCents: 4000,
    });
    const path = `/api/portal/reservations/${SOME_ID}/history`;
    const theirs = await call<{ history: unknown[] }>(historyRoute, request("GET", path, { cookie: orchardOwner }), {
      id: SOME_ID,
    });
    expect(theirs.body.history).toEqual([]);
    const ours = await call<{ history: { label: string; amountCents: number }[] }>(
      historyRoute,
      request("GET", path, { cookie: host }),
      { id: SOME_ID },
    );
    expect(ours.body.history).toMatchObject([{ label: "Refund", amountCents: 4000 }]);
  });
});
