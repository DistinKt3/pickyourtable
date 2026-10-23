import { tableCode, updateTableBody } from "@/lib/api/contracts";
import { api } from "@/lib/http/api";
import { OWNER, portalWriter } from "@/lib/portal/guard";
import { updateTable } from "@/lib/portal/tables";
import { z } from "zod";

export const dynamic = "force-dynamic";

/**
 * Changes one table: bookable on or off, tier, up to 3 attributes (Owner only).
 * Existing bookings are untouched; the change applies to new holds.
 */
export const PATCH = api({ params: z.object({ code: tableCode }), body: updateTableBody }, async ({ req, params, body }) => {
  const op = await portalWriter(req, OWNER);
  return { table: await updateTable(op, params.code, body) };
});
