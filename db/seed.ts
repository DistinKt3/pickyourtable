import "../scripts/_env";
import { and, eq, notInArray } from "drizzle-orm";
import { closeDb, db } from "@/db/client";
import { featureFlag, operator, priceRule, turnTime, venue, venueTable } from "@/db/schema";
import { env } from "@/lib/env";
import { listVenueIds, loadVenue } from "@/lib/venue/load";
import type { Venue } from "@/lib/venue/schema";

/**
 * Loads every venue folder into the database (PRD D-1).
 *
 *   pnpm db:seed            insert new venues and tables, keep owner edits
 *   pnpm db:seed --reset    overwrite table settings, prices and turn times from venue.json
 *   pnpm db:seed halcyon    one venue only
 */

const args = process.argv.slice(2);
const reset = args.includes("--reset");
const only = args.filter((a) => !a.startsWith("--"));

export async function seedVenue(v: Venue, opts: { reset: boolean }) {
  const e = env();
  const stripeAccountId =
    e.PAYMENTS_MODE === "stripe" ? (e.STRIPE_CONNECTED_ACCOUNT_ID ?? null) : `acct_sim_${v.id.replace(/-/g, "_")}`;
  const now = new Date();

  await db().transaction(async (tx) => {
    await tx
      .insert(venue)
      .values({
        id: v.id,
        name: v.name,
        timezone: v.timezone,
        stripeAccountId,
        applicationFeeBps: Math.round(v.booking.applicationFeePercent * 100),
        live: v.demo,
        wentLiveAt: v.demo ? now : null,
      })
      .onConflictDoUpdate({
        target: venue.id,
        set: {
          name: v.name,
          timezone: v.timezone,
          stripeAccountId,
          applicationFeeBps: Math.round(v.booking.applicationFeePercent * 100),
        },
      });

    const tierBookable = new Map(v.tiers.map((t) => [t.id, t.bookable]));
    for (const [i, t] of v.tables.entries()) {
      const config = {
        label: t.label,
        tier: t.tier,
        seats: t.seats,
        minParty: t.minParty,
        maxParty: t.maxParty,
        attributes: [...t.attributes],
        photoId: t.photoId,
        bookable: t.bookable ?? tierBookable.get(t.tier) ?? false,
        sort: i,
      };
      await tx
        .insert(venueTable)
        .values({ venueId: v.id, code: t.id, ...config, approvedAt: v.demo ? now : null })
        .onConflictDoUpdate({
          target: [venueTable.venueId, venueTable.code],
          // Geometry-bound fields always follow venue.json; owner settings only on --reset.
          set: opts.reset
            ? { ...config, updatedAt: now }
            : {
                label: t.label,
                seats: t.seats,
                minParty: t.minParty,
                maxParty: t.maxParty,
                photoId: t.photoId,
                sort: i,
                updatedAt: now,
              },
        });
    }
    // Tables removed from venue.json stop being bookable; history keeps their rows.
    await tx
      .update(venueTable)
      .set({ bookable: false })
      .where(
        and(
          eq(venueTable.venueId, v.id),
          notInArray(
            venueTable.code,
            v.tables.map((t) => t.id),
          ),
        ),
      );

    const existingRules = await tx.select({ id: priceRule.id }).from(priceRule).where(eq(priceRule.venueId, v.id)).limit(1);
    if (opts.reset || existingRules.length === 0) {
      await tx.delete(priceRule).where(eq(priceRule.venueId, v.id));
      const rows = Object.entries(v.booking.fees).flatMap(([tier, fee]) =>
        v.booking.dayparts.flatMap((d) => [
          { venueId: v.id, tier, daypart: d.id, dayType: "weeknight" as const, feeCents: fee.weeknight },
          { venueId: v.id, tier, daypart: d.id, dayType: "weekend" as const, feeCents: fee.weekend },
        ]),
      );
      if (rows.length) await tx.insert(priceRule).values(rows);
    }

    const existingTurns = await tx.select({ id: turnTime.id }).from(turnTime).where(eq(turnTime.venueId, v.id)).limit(1);
    if (opts.reset || existingTurns.length === 0) {
      await tx.delete(turnTime).where(eq(turnTime.venueId, v.id));
      await tx.insert(turnTime).values(v.booking.turnTimes.map((t) => ({ venueId: v.id, ...t })));
    }

    if (v.demo) {
      const domain = `${v.id}.example`;
      await tx
        .insert(operator)
        .values([
          { venueId: v.id, email: `owner@${domain}`, name: "Avery Lin", role: "owner" },
          { venueId: v.id, email: `host@${domain}`, name: "Jordan Reyes", role: "host" },
        ])
        .onConflictDoNothing();
    }
  });
}

async function main() {
  const ids = only.length ? only : await listVenueIds();
  for (const id of ids) {
    const v = await loadVenue(id);
    await seedVenue(v, { reset });
    console.log(JSON.stringify({ event: "db.seeded", venue: id, tables: v.tables.length, reset }));
  }
  await db().insert(featureFlag).values({ key: "pyt_widget_enabled", enabled: true }).onConflictDoNothing();
  await closeDb();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
