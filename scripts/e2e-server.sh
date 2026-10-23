#!/usr/bin/env bash
# Production build on :3100 against a fresh database, simulated Stripe, the dev
# mail store and Turnstile's offline test keys. Used by `pnpm test:e2e`.
set -euo pipefail
cd "$(dirname "$0")/.."

export NEXT_TELEMETRY_DISABLED=1
export NODE_ENV=production
export E2E_DB="${E2E_DB:-pyt_e2e}"
export DATABASE_URL="postgres://pyt:pyt_local_only@127.0.0.1:54329/${E2E_DB}"
export APP_URL="http://localhost:3100"
export APP_SECRET="${APP_SECRET:-e2e-secret-e2e-secret-e2e-secret-0123456789}"
export CRON_SECRET="e2e-cron-secret-0123456789"
export PAYMENTS_MODE=sim
export EMAIL_MODE=dev
export TURNSTILE_MODE=offline-test
export PYT_TEST_DEPLOYMENT=1
export TURNSTILE_SECRET_KEY="1x0000000000000000000000000000000AA"
export JOBS_INPROCESS=1
export TRUST_PROXY=xff
export RATE_LIMIT_SCALE="${RATE_LIMIT_SCALE:-5}"
for k in STRIPE_SECRET_KEY STRIPE_PUBLISHABLE_KEY STRIPE_WEBHOOK_SECRET STRIPE_CONNECTED_ACCOUNT_ID POSTMARK_SERVER_TOKEN; do unset "$k"; done

docker exec pickyourtable-db-1 psql -U pyt -d pyt -qc "DROP DATABASE IF EXISTS ${E2E_DB} WITH (FORCE)"
docker exec pickyourtable-db-1 psql -U pyt -d pyt -qc "CREATE DATABASE ${E2E_DB}"
npx tsx --conditions=react-server db/migrate.ts
npx tsx --conditions=react-server db/seed.ts --reset

if [ "${E2E_SKIP_BUILD:-0}" != "1" ]; then
  npx next build
fi
exec npx next start -p 3100
