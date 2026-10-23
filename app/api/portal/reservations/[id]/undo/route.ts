import { idParams, type ReservationActionResponse } from "@/lib/api/contracts";
import { undoArrival } from "@/lib/booking/operations";
import { api } from "@/lib/http/api";
import { ANY_ROLE, portalWriter } from "@/lib/portal/guard";
import { callOperation } from "@/lib/portal/operations";

export const dynamic = "force-dynamic";

/** Puts a seated or no-show booking back to confirmed (Host or Owner), when no refund was issued. */
export const POST = api({ params: idParams }, async ({ req, params }): Promise<ReservationActionResponse> => {
  const op = await portalWriter(req, ANY_ROLE);
  return callOperation(() =>
    undoArrival({ venueId: op.venueId, reservationId: params.id, actor: { type: "operator", id: op.operatorId } }),
  );
});
