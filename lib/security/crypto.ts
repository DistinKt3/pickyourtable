import "server-only";
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { env } from "@/lib/env";

/** URL-safe random token with `bytes` of entropy (32 bytes = 256 bits). */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("base64url");
}

/** A purpose-bound key derived from APP_SECRET, so one secret never signs two kinds of thing. */
export function derivedKey(purpose: string): Buffer {
  return createHmac("sha256", env().APP_SECRET).update(`pyt:${purpose}:v1`).digest();
}

/**
 * Keyed hash of an identifier (IP address, device id, email) so limits can count
 * them without storing the raw value.
 */
export function hashIdentifier(kind: "ip" | "device" | "email", value: string): string {
  return createHmac("sha256", derivedKey(`id-${kind}`))
    .update(value)
    .digest("base64url")
    .slice(0, 32);
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}
