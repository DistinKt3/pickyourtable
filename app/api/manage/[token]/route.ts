import { tokenParams } from "@/lib/api/contracts";
import { limitManage } from "@/lib/booking/http";
import { manageView } from "@/lib/booking/manage";
import { api } from "@/lib/http/api";

/** GET /api/manage/{token}: the booking, the refund the policy gives right now, and whether it can be cancelled. */
export const GET = api({ guest: true, params: tokenParams }, async ({ req, params }) => {
  await limitManage(req);
  return manageView(params.token);
});
