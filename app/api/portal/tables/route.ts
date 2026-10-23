import type { TablesResponse } from "@/lib/api/contracts";
import { api } from "@/lib/http/api";
import { OWNER, portalReader } from "@/lib/portal/guard";
import { listTables } from "@/lib/portal/tables";

export const dynamic = "force-dynamic";

/** Every table with its owner settings (PRD O-3). Owner only. */
export const GET = api({}, async ({ req }): Promise<TablesResponse> => {
  const op = await portalReader(req, OWNER);
  return listTables(op.venueId);
});
