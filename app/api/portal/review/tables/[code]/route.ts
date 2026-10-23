import { z } from "zod";
import { approveBody, tableCode } from "@/lib/api/contracts";
import { api } from "@/lib/http/api";
import { OWNER, portalWriter } from "@/lib/portal/guard";
import { setApproval } from "@/lib/portal/review";

export const dynamic = "force-dynamic";

/** Approves or unapproves one table's position and seat view (Owner only). */
export const POST = api({ params: z.object({ code: tableCode }), body: approveBody }, async ({ req, params, body }) => {
  const op = await portalWriter(req, OWNER);
  return { table: await setApproval(op, params.code, body.approved) };
});
