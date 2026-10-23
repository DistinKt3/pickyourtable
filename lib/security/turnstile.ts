import "server-only";
import { env } from "@/lib/env";
import { log } from "@/lib/log";

/**
 * Cloudflare Turnstile check before a hold (PRD S-4).
 *
 * `live` calls siteverify. `offline-test` reproduces Cloudflare's documented test
 * secrets without a network call, for machines that cannot reach Cloudflare:
 * 1x... always passes, 2x... always fails, 3x... reports a spent token.
 */

const SITEVERIFY = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

export type TurnstileResult = { ok: true } | { ok: false; reason: "missing" | "failed" | "unavailable" };

export async function verifyTurnstile(token: string | undefined, ip: string): Promise<TurnstileResult> {
  if (!token || token.length > 2048) return { ok: false, reason: "missing" };
  const { TURNSTILE_SECRET_KEY: secret, TURNSTILE_MODE: mode } = env();

  if (mode === "offline-test") {
    if (secret.startsWith("1x")) return { ok: true };
    return { ok: false, reason: "failed" };
  }

  try {
    const body = new URLSearchParams({ secret, response: token });
    if (ip && ip !== "local") body.set("remoteip", ip);
    const res = await fetch(SITEVERIFY, { method: "POST", body, signal: AbortSignal.timeout(5000) });
    const data = (await res.json()) as { success?: boolean; "error-codes"?: string[] };
    if (data.success) return { ok: true };
    log.warn("turnstile.failed", { codes: data["error-codes"] ?? [] });
    return { ok: false, reason: "failed" };
  } catch (e) {
    log.error("turnstile.unavailable", { error: e });
    return { ok: false, reason: "unavailable" };
  }
}
