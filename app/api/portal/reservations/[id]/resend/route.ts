import { idParams } from "@/lib/api/contracts";
import { resendConfirmation } from "@/lib/booking/operations";
import { api } from "@/lib/http/api";
import { ANY_ROLE, portalWriter } from "@/lib/portal/guard";
import { callOperation } from "@/lib/portal/operations";

export const dynamic = "force-dynamic";

/** Sends the guest's confirmation email again (Host or Owner). */
export const POST = api({ params: idParams }, async ({ req, params }) => {
  const op = await portalWriter(req, ANY_ROLE);
  await callOperation(() =>
    resendConfirmation({ venueId: op.venueId, reservationId: params.id, actor: { type: "operator", id: op.operatorId } }),
  );
  return { ok: true as const };
});
