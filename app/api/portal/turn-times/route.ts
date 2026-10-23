import { turnTimesBody } from "@/lib/api/contracts";
import { api } from "@/lib/http/api";
import { OWNER, portalWriter } from "@/lib/portal/guard";
import { saveTurnTimes } from "@/lib/portal/pricing";

export const dynamic = "force-dynamic";

/** Replaces the turn times (Owner only). They must cover every party size without gaps. */
export const PUT = api({ body: turnTimesBody }, async ({ req, body }) => {
  const op = await portalWriter(req, OWNER);
  return { turnTimes: await saveTurnTimes(op, body.turnTimes) };
});
