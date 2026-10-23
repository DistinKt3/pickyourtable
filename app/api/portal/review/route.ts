import type { ReviewResponse } from "@/lib/api/contracts";
import { api } from "@/lib/http/api";
import { OWNER, portalReader } from "@/lib/portal/guard";
import { getReview } from "@/lib/portal/review";

export const dynamic = "force-dynamic";

/** Every table's position and seat view for approval (PRD O-6). Owner only. */
export const GET = api({}, async ({ req }): Promise<ReviewResponse> => {
  const op = await portalReader(req, OWNER);
  return getReview(op.venueId);
});
