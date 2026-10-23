import type { z } from "zod";
import type { goLiveResponse } from "@/lib/api/contracts";
import { api } from "@/lib/http/api";
import { OWNER, portalWriter } from "@/lib/portal/guard";
import { goLive } from "@/lib/portal/review";

export const dynamic = "force-dynamic";

/** Takes the venue live (Owner only). 409 `not_all_approved` until every table is approved (PRD O-6). */
export const POST = api({}, async ({ req }): Promise<z.infer<typeof goLiveResponse>> => {
  const op = await portalWriter(req, OWNER);
  return goLive(op);
});
