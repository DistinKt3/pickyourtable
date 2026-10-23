import { and, desc, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { POST as goLiveRoute } from "@/app/api/portal/review/go-live/route";
import { GET as reviewRoute } from "@/app/api/portal/review/route";
import { POST as approveRoute } from "@/app/api/portal/review/tables/[code]/route";
import { db } from "@/db/client";
import { auditLog, venue } from "@/db/schema";
import type { ReviewResponse } from "@/lib/api/contracts";
import { call, errorCode, ORCHARD_OWNER, request, signIn } from "./helpers";

// Orchard Room, so other files' Halcyon tests are unaffected.
let owner: string;

const count = async () =>
  (
    await db()
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.venueId, "orchard-room"), eq(auditLog.action, "table.approved")))
  ).length;

const approve = (code: string, approved: boolean) =>
  call(approveRoute, request("POST", `/api/portal/review/tables/${code}`, { cookie: owner, body: { approved } }), { code });
const goLive = () => call(goLiveRoute, request("POST", "/api/portal/review/go-live", { cookie: owner }));

beforeAll(async () => {
  owner = await signIn(ORCHARD_OWNER);
  // Start from a venue that has not gone live yet.
  await db().update(venue).set({ live: false, wentLiveAt: null }).where(eq(venue.id, "orchard-room"));
});

describe("venue review (O-6)", () => {
  it("shows every table's position and seat view", async () => {
    const r = await call<ReviewResponse>(reviewRoute, request("GET", "/api/portal/review", { cookie: owner }));
    expect(r.status).toBe(200);
    expect(r.body.live).toBe(false);
    expect(r.body.tables).toHaveLength(14);
    const g1 = r.body.tables.find((t) => t.code === "G1")!;
    expect(g1).toMatchObject({ label: "Garden 1", approvedAt: expect.any(String), image: { kind: "render" } });
    expect(typeof g1.x).toBe("number");
    expect(typeof g1.z).toBe("number");
    expect(typeof g1.rotation).toBe("number");
    expect(g1.image.fallback).toBe("/venues/orchard-room/renders/G1-1280.webp");
  });

  it("refuses to go live while a table is unapproved, then allows it once all are approved", async () => {
    const off = await approve("N2", false);
    expect(off.status).toBe(200);
    expect(off.body).toMatchObject({ table: { code: "N2", approvedAt: null } });

    const refused = await goLive();
    expect(refused.status).toBe(409);
    expect(errorCode(refused)).toBe("not_all_approved");
    expect(refused.body).toMatchObject({
      error: { message: "Approve every table before going live. 1 table still needs review.", waiting: ["N2"] },
    });
    const [still] = await db().select({ live: venue.live }).from(venue).where(eq(venue.id, "orchard-room"));
    expect(still?.live).toBe(false);

    const on = await approve("N2", true);
    expect(on.body).toMatchObject({ table: { code: "N2", approvedAt: expect.any(String) } });

    const live = await goLive();
    expect(live.status).toBe(200);
    expect(live.body).toEqual({ live: true });
    const [row] = await db().select().from(venue).where(eq(venue.id, "orchard-room"));
    expect(row?.live).toBe(true);
    expect(row?.wentLiveAt).toBeInstanceOf(Date);

    const audits = await db()
      .select({ action: auditLog.action, details: auditLog.details })
      .from(auditLog)
      .where(eq(auditLog.venueId, "orchard-room"))
      .orderBy(desc(auditLog.id))
      .limit(3);
    expect(audits.map((a) => a.action)).toEqual(["venue.went_live", "table.approved", "table.unapproved"]);
    expect(audits[1]?.details).toMatchObject({ table: "N2" });
  });

  it("counts several waiting tables and names them", async () => {
    await approve("K1", false);
    await approve("K3", false);
    const r = await goLive();
    expect(r.body).toMatchObject({
      error: { message: "Approve every table before going live. 2 tables still need review.", waiting: ["K1", "K3"] },
    });
    await approve("K1", true);
    await approve("K3", true);
    expect((await goLive()).status).toBe(200);
  });

  it("approving twice changes nothing and writes no second audit row", async () => {
    const before = await count();
    expect((await approve("G1", true)).status).toBe(200);
    expect(await count()).toBe(before);
  });
});
