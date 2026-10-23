import { upsertPriceRuleBody } from "@/lib/api/contracts";
import { todayIn } from "@/lib/format";
import { api } from "@/lib/http/api";
import { OWNER, portalWriter } from "@/lib/portal/guard";
import { saveRule } from "@/lib/portal/pricing";
import { loadVenue } from "@/lib/venue/load";

export const dynamic = "force-dynamic";

/**
 * Saves one fee (Owner only). Applies to new holds only: every reservation keeps the
 * price it was booked at (PRD O-3).
 */
export const PUT = api({ body: upsertPriceRuleBody }, async ({ req, body }) => {
  const op = await portalWriter(req, OWNER);
  const venue = await loadVenue(op.venueId);
  return { rule: await saveRule(op, body, todayIn(venue.timezone)) };
});
