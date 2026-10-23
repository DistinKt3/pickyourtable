import "server-only";
import { env } from "@/lib/env";
import { ApiError, tooMany } from "@/lib/http/api";
import { createHash, timingSafeEqual } from "node:crypto";
import { LIMITS, rateLimit } from "@/lib/security/rate-limit";
import { ipHash } from "@/lib/security/request";

/** Request guards shared by the booking routes. */

/** Availability reads per IP (red-team case: scraping availability at a high rate gets 429). */
export async function limitAvailability(req: Request): Promise<void> {
  const res = await rateLimit("availability", ipHash(req), LIMITS.availability);
  if (!res.ok) throw tooMany(res.retryAfterSeconds, "Too many requests. Please wait a moment and try again.");
}

/** Manage-link actions per IP. */
export async function limitManage(req: Request): Promise<void> {
  const res = await rateLimit("manage", ipHash(req), LIMITS.manage);
  if (!res.ok) throw tooMany(res.retryAfterSeconds);
}

const digest = (s: string) => createHash("sha256").update(s).digest();

/** Scheduled job endpoints: `Authorization: Bearer ${CRON_SECRET}`, compared in constant time. */
export function requireCron(req: Request): void {
  const secret = env().CRON_SECRET;
  const header = req.headers.get("authorization") ?? "";
  if (!secret || !timingSafeEqual(digest(header), digest(`Bearer ${secret}`))) {
    throw new ApiError(401, "unauthorized", "Not authorized.");
  }
}
