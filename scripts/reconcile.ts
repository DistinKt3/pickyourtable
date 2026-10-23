import "./_env";
import { closeDb } from "@/db/client";
import { reconcile } from "@/lib/booking/jobs";

/**
 * Compares every booking that touched money with the payment provider, to the cent.
 *
 *   npx tsx --conditions=react-server scripts/reconcile.ts [--days 45]
 *
 * Prints the report as JSON and exits 1 when anything does not match.
 */

const args = process.argv.slice(2);
const daysAt = args.indexOf("--days");
const days = daysAt >= 0 ? Number(args[daysAt + 1]) : 45;
if (!Number.isFinite(days) || days <= 0) {
  console.error("Usage: reconcile.ts [--days <number>]");
  process.exit(2);
}

let failed = false;
try {
  const report = await reconcile({ since: new Date(Date.now() - days * 86_400_000) });
  console.log(JSON.stringify(report, null, 2));
  failed = report.mismatches.length > 0;
} finally {
  await closeDb();
}
process.exit(failed ? 1 : 0);
