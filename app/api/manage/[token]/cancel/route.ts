import { tokenParams } from "@/lib/api/contracts";
import { limitManage } from "@/lib/booking/http";
import { cancelByGuest } from "@/lib/booking/manage";
import { api } from "@/lib/http/api";

/** POST /api/manage/{token}/cancel: cancels with the refund recomputed on the server (PRD G-9). */
export const POST = api({ guest: true, params: tokenParams }, async ({ req, params }) => {
  await limitManage(req);
  return cancelByGuest(params.token);
});
