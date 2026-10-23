import "server-only";
import { sql } from "drizzle-orm";
import { PG, pgCode, type Tx } from "@/db/client";

/**
 * Serializes every write that the no-overlap constraint checks for one table (a new
 * hold, a late payment re-confirming an expired one). Two transactions inserting
 * conflicting rows at the same moment can otherwise each wait on the other's
 * uncommitted row until Postgres aborts one with a deadlock error. With this lock the
 * second simply waits, then gets the clean exclusion violation. Take it after any
 * per-device lock so the lock order is always the same.
 */
export async function lockTable(tx: Tx, tableId: string): Promise<void> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`booking-table:${tableId}`}, 0))`);
}

/** The guest lost the race for the table: the constraint fired, or Postgres broke a deadlock. */
export function lostRace(e: unknown): boolean {
  const code = pgCode(e);
  return code === PG.exclusionViolation || code === PG.deadlockDetected;
}
