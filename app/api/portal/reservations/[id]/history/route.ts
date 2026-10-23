import { idParams } from "@/lib/api/contracts";
import { api } from "@/lib/http/api";
import { portalReader } from "@/lib/portal/guard";
import { reservationHistory } from "@/lib/portal/history";

export const dynamic = "force-dynamic";

/** A booking's history (payments, refunds, seating), from the audit log, for this venue only. */
export const GET = api({ params: idParams }, async ({ req, params }) => {
  const op = await portalReader(req);
  return { history: await reservationHistory(op.venueId, params.id) };
});
