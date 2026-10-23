import { idParams } from "@/lib/api/contracts";
import { api } from "@/lib/http/api";
import { deleteBlackout } from "@/lib/portal/blackouts";
import { OWNER, portalWriter } from "@/lib/portal/guard";
import { loadVenue } from "@/lib/venue/load";

export const dynamic = "force-dynamic";

/** Removes a blackout (Owner only); the table is bookable again on the next availability poll. */
export const DELETE = api({ params: idParams }, async ({ req, params }) => {
  const op = await portalWriter(req, OWNER);
  const { timezone } = await loadVenue(op.venueId);
  await deleteBlackout(op, timezone, params.id);
  return { ok: true as const };
});
