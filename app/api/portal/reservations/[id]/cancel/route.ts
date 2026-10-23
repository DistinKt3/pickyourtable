import { cancelBody, idParams, type ReservationActionResponse } from "@/lib/api/contracts";
import { cancelByVenue } from "@/lib/booking/operations";
import { api } from "@/lib/http/api";
import { OWNER, portalWriter } from "@/lib/portal/guard";
import { callOperation } from "@/lib/portal/operations";

export const dynamic = "force-dynamic";

/** Cancels a booking with a full refund and emails the guest (PRD O-2). Owner only: money moves. */
export const POST = api(
  { params: idParams, body: cancelBody },
  async ({ req, params, body }): Promise<ReservationActionResponse> => {
    const op = await portalWriter(req, OWNER);
    return callOperation(() =>
      cancelByVenue({
        venueId: op.venueId,
        reservationId: params.id,
        reason: body.reason,
        actor: { type: "operator", id: op.operatorId },
      }),
    );
  },
);
