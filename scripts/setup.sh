#!/usr/bin/env bash
# One-command setup from a clean clone: pnpm run setup
set -euo pipefail
cd "$(dirname "$0")/.."

say() { printf '\n\033[1m%s\033[0m\n' "$1"; }

say "Checking tools"
node -e 'const [maj,min]=process.versions.node.split(".").map(Number); if(!((maj===24&&min>=22)||maj>=26)){console.error("Node 24.22+ or 26.12+ is required, found "+process.version);process.exit(1)}'
command -v pnpm >/dev/null || { echo "pnpm is required: brew install pnpm (or: npm install -g pnpm@12.15.0)"; exit 1; }
command -v docker >/dev/null || { echo "Docker is required for the local database: install Docker Desktop (brew install --cask docker), open it, then run pnpm run setup again."; exit 1; }
docker info >/dev/null 2>&1 || { echo "Docker is installed but not running. Open Docker Desktop, wait until it says it is running, then run pnpm run setup again."; exit 1; }

if [ ! -f .env.local ]; then
  say "Creating .env.local"
  secret=$(node -e 'console.log(require("node:crypto").randomBytes(32).toString("base64url"))')
  cron=$(node -e 'console.log(require("node:crypto").randomBytes(24).toString("base64url"))')
  sed -e "s|^APP_SECRET=.*|APP_SECRET=${secret}|" -e "s|^CRON_SECRET=.*|CRON_SECRET=${cron}|" .env.example > .env.local
fi

say "Installing dependencies"
pnpm install --frozen-lockfile

say "Starting Postgres 18"
docker compose up -d --wait db

say "Migrating and seeding"
pnpm db:migrate
pnpm db:seed

say "Ready. Start the app with: pnpm dev"
echo "Then open http://localhost:3000/v/halcyon (guest) and http://localhost:3000/portal (venue portal)."
