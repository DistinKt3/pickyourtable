import type { PricingResponse } from "@/lib/api/contracts";
import { api } from "@/lib/http/api";
import { OWNER, portalReader } from "@/lib/portal/guard";
import { getPricing } from "@/lib/portal/pricing";

export const dynamic = "force-dynamic";

/** Fees per tier, daypart and day type, special dates and turn times (PRD O-3). Owner only. */
export const GET = api({}, async ({ req }): Promise<PricingResponse> => {
  const op = await portalReader(req, OWNER);
  return getPricing(op.venueId);
});
