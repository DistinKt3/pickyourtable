import "server-only";
import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { venue, venueTable } from "@/db/schema";
import type { PortalTable, ReviewResponse } from "@/lib/api/contracts";
import type { OperatorSession } from "@/lib/auth/session";
import { ApiError } from "@/lib/http/api";
import { loadVenue } from "@/lib/venue/load";
import { seatViewImage } from "@/lib/venue/media";
import { audit } from "./audit";
import { toPortalTable, venueTableRows } from "./tables";

/**
 * Venue review (PRD O-6): the owner checks every table's position and seat view and
 * approves it. The venue cannot go live until every table is approved.
 */

export async function getReview(venueId: string): Promise<ReviewResponse> {
  const [config, rows, vrows] = await Promise.all([
    loadVenue(venueId),
    venueTableRows(venueId),
    db().select({ live: venue.live }).from(venue).where(eq(venue.id, venueId)),
  ]);
  const geometry = new Map(config.tables.map((t) => [t.id, t]));
  return {
    live: vrows[0]?.live ?? false,
    tables: rows.map((r) => {
      const g = geometry.get(r.code)!;
      const image = seatViewImage(venueId, { id: r.code, photoId: r.photoId });
      return Object.assign(toPortalTable(r), {
        x: g.x,
        z: g.z,
        rotation: g.rotation,
        image: { kind: image.kind, avif: image.avif, webp: image.webp, fallback: image.fallback },
      });
    }),
  };
}

export async function setApproval(op: OperatorSession, code: string, approved: boolean): Promise<PortalTable> {
  const config = await loadVenue(op.venueId);
  if (!config.tables.some((t) => t.id === code)) throw new ApiError(404, "table_not_found", "That table is not in this venue.");
  return db().transaction(async (tx) => {
    await tx.select({ id: venue.id }).from(venue).where(eq(venue.id, op.venueId)).for("update");
    const [row] = await tx
      .select()
      .from(venueTable)
      .where(and(eq(venueTable.venueId, op.venueId), eq(venueTable.code, code)))
      .for("update");
    if (!row) throw new ApiError(404, "table_not_found", "That table is not in this venue.");
    if (Boolean(row.approvedAt) === approved) return toPortalTable(row);
    const [updated] = await tx
      .update(venueTable)
      .set(approved ? { approvedAt: new Date(), approvedBy: op.operatorId } : { approvedAt: null, approvedBy: null })
      .where(eq(venueTable.id, row.id))
      .returning();
    await audit(tx, op, approved ? "table.approved" : "table.unapproved", { table: code, photoId: row.photoId });
    return toPortalTable(updated!);
  });
}

export async function goLive(op: OperatorSession): Promise<{ live: true }> {
  const config = await loadVenue(op.venueId);
  const codes = new Set(config.tables.map((t) => t.id));
  await db().transaction(async (tx) => {
    // Lock the venue row first so approvals and go-live cannot interleave.
    const [row] = await tx.select().from(venue).where(eq(venue.id, op.venueId)).for("update");
    const tables = (await tx.select().from(venueTable).where(eq(venueTable.venueId, op.venueId))).filter((t) =>
      codes.has(t.code),
    );
    const waiting = tables.filter((t) => !t.approvedAt);
    if (waiting.length > 0) {
      const n = waiting.length;
      throw new ApiError(
        409,
        "not_all_approved",
        `Approve every table before going live. ${n} ${n === 1 ? "table still needs" : "tables still need"} review.`,
        { waiting: waiting.map((t) => t.code) },
      );
    }
    if (row?.live) return;
    await tx.update(venue).set({ live: true, wentLiveAt: new Date() }).where(eq(venue.id, op.venueId));
    await audit(tx, op, "venue.went_live", { tables: tables.length });
  });
  return { live: true };
}
