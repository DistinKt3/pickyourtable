import { idParams, type ReservationActionResponse, seatBody } from "@/lib/api/contracts";
import { seatReservation } from "@/lib/booking/operations";
import { api } from "@/lib/http/api";
import { ANY_ROLE, portalWriter } from "@/lib/portal/guard";
import { callOperation } from "@/lib/portal/operations";

export const dynamic = "force-dynamic";

/**
 * Marks a guest seated (Host or Owner). Seating at a different table than the one
 * they paid for refunds their fee automatically (PRD product decisions).
 */
export const POST = api(
  { params: idParams, body: seatBody },
  async ({ req, params, body }): Promise<ReservationActionResponse> => {
    const op = await portalWriter(req, ANY_ROLE);
    return callOperation(() =>
      seatReservation({
        venueId: op.venueId,
        reservationId: params.id,
        tableCode: body.table,
        actor: { type: "operator", id: op.operatorId },
      }),
    );
  },
);
