import { type TonightResponse, tonightQuery } from "@/lib/api/contracts";
import { listTonight } from "@/lib/booking/operations";
import { api } from "@/lib/http/api";
import { portalReader } from "@/lib/portal/guard";
import { callOperation } from "@/lib/portal/operations";

export const dynamic = "force-dynamic";

/** Tonight (PRD O-1): the date's paid bookings and every table's state. Polled every 1.5 s. */
export const GET = api({ query: tonightQuery }, async ({ req, query }): Promise<TonightResponse> => {
  const op = await portalReader(req);
  return callOperation(() => listTonight({ venueId: op.venueId, date: query.date }));
});
