import "server-only";
import { and, asc, eq, ne } from "drizzle-orm";
import { db } from "@/db/client";
import { priceRule, venueTable } from "@/db/schema";
import type { PortalTable, TablesResponse } from "@/lib/api/contracts";
import type { OperatorSession } from "@/lib/auth/session";
import { ApiError } from "@/lib/http/api";
import { loadVenue } from "@/lib/venue/load";
import { ATTRIBUTES } from "@/lib/venue/schema";
import { audit } from "./audit";
import { MAX_ATTRIBUTES } from "./rules";

/**
 * Tables and their owner-controlled settings (PRD O-3): bookable, tier and up to 3
 * attributes. Geometry stays in venue.json; these live in the database.
 */

type TableRow = typeof venueTable.$inferSelect;

export function toPortalTable(r: TableRow): PortalTable {
  return {
    code: r.code,
    label: r.label,
    tier: r.tier,
    seats: r.seats,
    minParty: r.minParty,
    maxParty: r.maxParty,
    attributes: r.attributes,
    bookable: r.bookable,
    photoId: r.photoId,
    approvedAt: r.approvedAt?.toISOString() ?? null,
  };
}

/** The venue's tables as venue.json lists them (tables removed from the file are left out). */
export async function venueTableRows(venueId: string): Promise<TableRow[]> {
  const [config, rows] = await Promise.all([
    loadVenue(venueId),
    db().select().from(venueTable).where(eq(venueTable.venueId, venueId)).orderBy(asc(venueTable.sort)),
  ]);
  const codes = new Set(config.tables.map((t) => t.id));
  return rows.filter((r) => codes.has(r.code));
}

export async function tierOptions(venueId: string) {
  const config = await loadVenue(venueId);
  return config.tiers.map((t) => ({ id: t.id, name: t.name, color: t.color, bookable: t.bookable }));
}

export async function listTables(venueId: string): Promise<TablesResponse> {
  const [rows, tiers] = await Promise.all([venueTableRows(venueId), tierOptions(venueId)]);
  return { tables: rows.map(toPortalTable), tiers, attributes: [...ATTRIBUTES] };
}

/** Tiers that have weeknight or weekend fees, so their tables can be booked. */
export async function pricedTiers(venueId: string): Promise<Set<string>> {
  const rows = await db()
    .selectDistinct({ tier: priceRule.tier })
    .from(priceRule)
    .where(and(eq(priceRule.venueId, venueId), ne(priceRule.dayType, "special")));
  return new Set(rows.map((r) => r.tier));
}

export interface TableChanges {
  bookable?: boolean;
  tier?: string;
  attributes?: string[];
}

export async function updateTable(op: OperatorSession, code: string, changes: TableChanges): Promise<PortalTable> {
  const config = await loadVenue(op.venueId);
  const tiers = new Map(config.tiers.map((t) => [t.id, t]));
  if (changes.tier !== undefined && !tiers.has(changes.tier)) {
    throw new ApiError(422, "unknown_tier", "Choose one of the venue's tiers.");
  }
  if (changes.attributes) {
    const known = new Set<string>(ATTRIBUTES);
    const unique = [...new Set(changes.attributes)];
    if (unique.some((a) => !known.has(a))) throw new ApiError(422, "unknown_attribute", "Choose attributes from the list.");
    if (unique.length > MAX_ATTRIBUTES) throw new ApiError(422, "too_many_attributes", "A table shows at most 3 attributes.");
    changes = { ...changes, attributes: unique };
  }

  return db().transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(venueTable)
      .where(and(eq(venueTable.venueId, op.venueId), eq(venueTable.code, code)))
      .for("update");
    if (!row || !config.tables.some((t) => t.id === code))
      throw new ApiError(404, "table_not_found", "That table is not in this venue.");

    const nextTier = changes.tier ?? row.tier;
    const nextBookable = changes.bookable ?? row.bookable;
    if (nextBookable) {
      const priced = await tx
        .selectDistinct({ tier: priceRule.tier })
        .from(priceRule)
        .where(and(eq(priceRule.venueId, op.venueId), eq(priceRule.tier, nextTier), ne(priceRule.dayType, "special")));
      if (priced.length === 0) {
        const name = tiers.get(nextTier)?.name ?? nextTier;
        throw new ApiError(422, "tier_not_priced", `${name} tables have no fees, so they cannot be booked online.`);
      }
    }

    const diff: Record<string, { from: unknown; to: unknown }> = {};
    if (changes.bookable !== undefined && changes.bookable !== row.bookable)
      diff.bookable = { from: row.bookable, to: changes.bookable };
    if (changes.tier !== undefined && changes.tier !== row.tier) diff.tier = { from: row.tier, to: changes.tier };
    if (changes.attributes && changes.attributes.join("|") !== row.attributes.join("|")) {
      diff.attributes = { from: row.attributes, to: changes.attributes };
    }
    if (Object.keys(diff).length === 0) return toPortalTable(row);

    const [updated] = await tx
      .update(venueTable)
      .set({
        ...(diff.bookable ? { bookable: nextBookable } : {}),
        ...(diff.tier ? { tier: nextTier } : {}),
        ...(diff.attributes ? { attributes: changes.attributes } : {}),
        updatedAt: new Date(),
      })
      .where(eq(venueTable.id, row.id))
      .returning();
    await audit(tx, op, "table.updated", { table: code, changes: diff });
    return toPortalTable(updated!);
  });
}
