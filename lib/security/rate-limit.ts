import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import { env } from "@/lib/env";

/**
 * Fixed-window rate limits stored in Postgres, so they hold across serverless
 * instances without another service.
 */

export interface Limit {
  limit: number;
  windowSeconds: number;
}

export const LIMITS = {
  /** Availability reads per IP. Polling uses about 12 a minute. */
  availability: { limit: 120, windowSeconds: 60 },
  /** Hold attempts per IP. */
  holdsPerIp: { limit: 12, windowSeconds: 600 },
  /** Checkout attempts per hold. */
  checkout: { limit: 10, windowSeconds: 600 },
  /** Magic-link requests per IP and per email. */
  magicLinkIp: { limit: 10, windowSeconds: 900 },
  magicLinkEmail: { limit: 3, windowSeconds: 900 },
  /** Manage-link actions per IP. */
  manage: { limit: 30, windowSeconds: 600 },
  /** Portal writes per operator. */
  portalWrite: { limit: 240, windowSeconds: 60 },
} satisfies Record<string, Limit>;

export interface RateResult {
  ok: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

export async function rateLimit(name: string, identifier: string, limit: Limit): Promise<RateResult> {
  const max = Math.floor(limit.limit * env().RATE_LIMIT_SCALE);
  const key = `${name}:${identifier}`;
  const interval = `${limit.windowSeconds} seconds`;
  const res = await db().execute<{ count: number; window_start: Date }>(sql`
    INSERT INTO rate_limit (key, window_start, count)
    VALUES (${key}, date_bin(${interval}::interval, now(), '2000-01-01'::timestamptz), 1)
    ON CONFLICT (key, window_start) DO UPDATE SET count = rate_limit.count + 1
    RETURNING count, window_start
  `);
  const row = res.rows[0]!;
  const windowEnd = new Date(row.window_start).getTime() + limit.windowSeconds * 1000;
  return {
    ok: row.count <= max,
    remaining: Math.max(0, max - row.count),
    retryAfterSeconds: Math.max(1, Math.ceil((windowEnd - Date.now()) / 1000)),
  };
}

export async function pruneRateLimits(): Promise<number> {
  const res = await db().execute(sql`DELETE FROM rate_limit WHERE window_start < now() - interval '1 day'`);
  return res.rowCount ?? 0;
}
