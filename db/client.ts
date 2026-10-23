import "server-only";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import { env } from "@/lib/env";
import * as schema from "./schema";

export type Db = NodePgDatabase<typeof schema>;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
/** Either the pool-backed client or an open transaction. */
export type Queryable = Db | Tx;

const g = globalThis as unknown as { __pytPool?: pg.Pool; __pytDb?: Db };

export function pool(): pg.Pool {
  g.__pytPool ??= new pg.Pool({
    connectionString: env().DATABASE_URL,
    max: Number(process.env.DATABASE_POOL_MAX ?? 10),
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 5_000,
    application_name: "pickyourtable",
  });
  return g.__pytPool;
}

/** Lazy, so importing a module never needs a database (for example during `next build`). */
export function db(): Db {
  g.__pytDb ??= drizzle(pool(), { schema });
  return g.__pytDb;
}

export async function closeDb(): Promise<void> {
  if (g.__pytPool) await g.__pytPool.end();
  g.__pytPool = undefined;
  g.__pytDb = undefined;
}

/** Postgres error codes the app handles explicitly. */
export const PG = {
  exclusionViolation: "23P01",
  uniqueViolation: "23505",
  checkViolation: "23514",
  serializationFailure: "40001",
  deadlockDetected: "40P01",
} as const;

export function pgCode(e: unknown): string | undefined {
  let cur: unknown = e;
  for (let i = 0; i < 4 && cur; i++) {
    const code = (cur as { code?: unknown }).code;
    if (typeof code === "string") return code;
    cur = (cur as { cause?: unknown }).cause;
  }
  return undefined;
}
