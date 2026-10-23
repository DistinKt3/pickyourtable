import { idParams } from "@/lib/api/contracts";
import { api } from "@/lib/http/api";
import { OWNER, portalWriter } from "@/lib/portal/guard";
import { deleteRule } from "@/lib/portal/pricing";

export const dynamic = "force-dynamic";

/** Removes a special-date fee (Owner only). Weeknight and weekend fees can be changed, not removed. */
export const DELETE = api({ params: idParams }, async ({ req, params }) => {
  const op = await portalWriter(req, OWNER);
  await deleteRule(op, params.id);
  return { ok: true as const };
});
