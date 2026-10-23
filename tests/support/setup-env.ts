// Test environment: an isolated database, simulated payments, the dev mail store and
// offline Turnstile test keys. Nothing here can reach a real service.
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgres://pyt:pyt_local_only@127.0.0.1:54329/pyt_test";
process.env.APP_SECRET ??= "test-secret-test-secret-test-secret-0123456789";
process.env.APP_URL ??= "http://localhost:3000";
process.env.PAYMENTS_MODE = "sim";
process.env.EMAIL_MODE = "dev";
process.env.TURNSTILE_MODE = "offline-test";
process.env.TURNSTILE_SECRET_KEY = "1x0000000000000000000000000000000AA";
process.env.TRUST_PROXY = "xff";
process.env.JOBS_INPROCESS = "0";
for (const k of [
  "STRIPE_SECRET_KEY",
  "STRIPE_PUBLISHABLE_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "STRIPE_CONNECTED_ACCOUNT_ID",
  "POSTMARK_SERVER_TOKEN",
]) {
  delete process.env[k];
}
