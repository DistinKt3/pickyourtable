import "server-only";
import { z } from "zod";

/**
 * Server environment, validated once. Secrets live only in environment settings
 * (PRD privacy controls). Browser-safe values reach the client as props, so one
 * build runs anywhere.
 */

const TURNSTILE_TEST_SITE_KEY = "1x00000000000000000000AA";
const TURNSTILE_TEST_SECRET = "1x0000000000000000000000000000000AA";

const schema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    DATABASE_URL: z.string().regex(/^postgres(ql)?:\/\//, "a postgres:// URL"),
    APP_URL: z.url().default("http://localhost:3000"),
    /** HMAC key for manage links, hold tokens and hashed identifiers. */
    APP_SECRET: z.string().min(32, "at least 32 characters"),

    PAYMENTS_MODE: z.enum(["stripe", "sim"]).optional(),
    STRIPE_SECRET_KEY: z
      .string()
      .regex(/^(sk|rk)_test_/, "test-mode keys only (sk_test_ or rk_test_)")
      .optional(),
    STRIPE_PUBLISHABLE_KEY: z
      .string()
      .regex(/^pk_test_/, "test-mode keys only (pk_test_)")
      .optional(),
    STRIPE_WEBHOOK_SECRET: z
      .string()
      .regex(/^whsec_/)
      .optional(),
    STRIPE_CONNECTED_ACCOUNT_ID: z
      .string()
      .regex(/^acct_/)
      .optional(),

    EMAIL_MODE: z.enum(["dev", "postmark"]).default("dev"),
    POSTMARK_SERVER_TOKEN: z.string().min(10).optional(),
    EMAIL_FROM: z.string().default("Pick-Your-Table Demo <bookings@pyt.example>"),

    TURNSTILE_SITE_KEY: z.string().default(TURNSTILE_TEST_SITE_KEY),
    TURNSTILE_SECRET_KEY: z.string().default(TURNSTILE_TEST_SECRET),
    /** `offline-test` verifies Cloudflare's documented test tokens without a network call. */
    TURNSTILE_MODE: z.enum(["live", "offline-test"]).default("live"),

    CRON_SECRET: z.string().min(16).optional(),
    /** Which client-IP header to trust: Vercel's, a generic proxy's, or none. */
    TRUST_PROXY: z.enum(["vercel", "xff", "none"]).default("none"),
    JOBS_INPROCESS: z.enum(["0", "1"]).default("0"),
    /** Comma-separated origins allowed to frame the guest widget (embed). */
    EMBED_ALLOWED_ORIGINS: z.string().default(""),
    /** Multiplies rate-limit allowances; 1 in production. */
    RATE_LIMIT_SCALE: z.coerce.number().min(1).max(1000).default(1),
  })
  .superRefine((v, ctx) => {
    const mode = v.PAYMENTS_MODE ?? (v.STRIPE_SECRET_KEY ? "stripe" : "sim");
    if (mode === "stripe") {
      for (const key of ["STRIPE_SECRET_KEY", "STRIPE_PUBLISHABLE_KEY", "STRIPE_WEBHOOK_SECRET"] as const) {
        if (!v[key]) ctx.addIssue({ code: "custom", path: [key], message: "required when PAYMENTS_MODE=stripe" });
      }
    }
    if (v.EMAIL_MODE === "postmark" && !v.POSTMARK_SERVER_TOKEN) {
      ctx.addIssue({ code: "custom", path: ["POSTMARK_SERVER_TOKEN"], message: "required when EMAIL_MODE=postmark" });
    }
    if (v.NODE_ENV === "production" && v.TURNSTILE_MODE === "offline-test" && process.env.PYT_ALLOW_OFFLINE_TURNSTILE !== "1") {
      ctx.addIssue({ code: "custom", path: ["TURNSTILE_MODE"], message: "offline-test is not allowed in production" });
    }
  });

export type Env = z.infer<typeof schema> & { PAYMENTS_MODE: "stripe" | "sim" };

let cached: Env | null = null;

export function env(): Env {
  if (cached) return cached;
  // An empty `KEY=` line means "not set".
  const raw = Object.fromEntries(Object.entries(process.env).filter(([, v]) => v !== undefined && v !== ""));
  const result = schema.safeParse(raw);
  if (!result.success) {
    const lines = result.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`);
    throw new Error(`Invalid environment:\n${lines.join("\n")}`);
  }
  const v = result.data;
  cached = { ...v, PAYMENTS_MODE: v.PAYMENTS_MODE ?? (v.STRIPE_SECRET_KEY ? "stripe" : "sim") };
  return cached;
}

/** For tests that change the environment between cases. */
export function resetEnvCache(): void {
  cached = null;
}

export const turnstileTestKeys = { siteKey: TURNSTILE_TEST_SITE_KEY, secret: TURNSTILE_TEST_SECRET };
