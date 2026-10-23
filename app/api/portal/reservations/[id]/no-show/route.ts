import { idParams, type ReservationActionResponse } from "@/lib/api/contracts";
import { markNoShow } from "@/lib/booking/operations";
import { api } from "@/lib/http/api";
import { ANY_ROLE, portalWriter } from "@/lib/portal/guard";
import { callOperation } from "@/lib/portal/operations";

export const dynamic = "force-dynamic";

/** Marks a booking as a no-show (Host or Owner). No refund (PRD refunds). */
export const POST = api({ params: idParams }, async ({ req, params }): Promise<ReservationActionResponse> => {
  const op = await portalWriter(req, ANY_ROLE);
  return callOperation(() =>
    markNoShow({ venueId: op.venueId, reservationId: params.id, actor: { type: "operator", id: op.operatorId } }),
  );
});
