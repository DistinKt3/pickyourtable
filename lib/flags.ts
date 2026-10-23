import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { featureFlag } from "@/db/schema";

/**
 * Kill switch (PRD S-5). Turning off `pyt_widget_enabled` hides the guest widget and
 * stops guest APIs within 60 seconds: each server instance caches the flag for 15 s.
 * `PYT_WIDGET_ENABLED=false` in the environment forces it off without the database.
 */

export const WIDGET_FLAG = "pyt_widget_enabled";
const TTL_MS = 15_000;

// One cache per process on globalThis: Next bundles pages and route handlers separately,
// and a module-level cache would let the page and the APIs disagree for up to a TTL.
const g = globalThis as unknown as { __pytWidgetFlag?: { value: boolean; at: number } | null };

export async function isWidgetEnabled(): Promise<boolean> {
  if (process.env.PYT_WIDGET_ENABLED === "false") return false;
  const cache = g.__pytWidgetFlag;
  if (cache && Date.now() - cache.at < TTL_MS) return cache.value;
  const rows = await db().select({ enabled: featureFlag.enabled }).from(featureFlag).where(eq(featureFlag.key, WIDGET_FLAG));
  const value = rows[0]?.enabled ?? true;
  g.__pytWidgetFlag = { value, at: Date.now() };
  return value;
}

export async function setFlag(key: string, enabled: boolean): Promise<void> {
  await db()
    .insert(featureFlag)
    .values({ key, enabled })
    .onConflictDoUpdate({ target: featureFlag.key, set: { enabled, updatedAt: new Date() } });
  if (key === WIDGET_FLAG) g.__pytWidgetFlag = null;
}

export function clearFlagCache(): void {
  g.__pytWidgetFlag = null;
}
