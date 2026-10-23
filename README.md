# Pick-Your-Table (prototype)

A guest explores an accurate 3D model of a dining room, taps a table, sees the view from that seat, and pays a fee to guarantee it. The venue runs it from a tablet portal at the host stand. Pick-Your-Table is the internal codename: guests only ever see the venue's name, colors and type.

This repository is the working prototype described in [`docs/PRD.md`](docs/PRD.md). How it is built is in [`docs/BUILD_PLAN.md`](docs/BUILD_PLAN.md), the open implementation choices in [`docs/DECISIONS.md`](docs/DECISIONS.md), security in [`docs/SECURITY.md`](docs/SECURITY.md), and the build gate results in [`docs/GATE_REPORT.md`](docs/GATE_REPORT.md).

## Quick start

Requirements: Node 26.12.1 (or 24.22.1 LTS), pnpm 12.15.0, Docker.

```bash
pnpm run setup      # .env.local, install, Postgres 18 in Docker, migrate, seed
pnpm dev            # http://localhost:3000
```

Then open:

| URL               | What it is                                                                                                              |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `/v/halcyon`      | The guest widget for the demo venue Halcyon                                                                             |
| `/v/orchard-room` | A second fixture venue with a different layout, time zone and tiers                                                     |
| `/demo/halcyon`   | A stand-in for the venue's own website, using the one-line embed                                                        |
| `/portal`         | The venue portal. Sign in as `owner@halcyon.example` or `host@halcyon.example`; the magic link arrives in the dev inbox |
| `/dev/mail`       | Dev inbox: every email the app sends, in development (elsewhere, only a signed-in operator's own mail)                  |

Payments run against a local Stripe simulator until you add Stripe test keys (see below). No real money moves in any mode: the app refuses live keys.

## The demo script (PRD)

1. Open `/v/halcyon` on a phone; the room appears.
2. Pick Friday, 8:00 pm, party of 2.
3. Tap Window 1; the seat view fills the sheet.
4. Tap Sit here, then swipe to Booth 2 to compare.
5. Reserve with Apple Pay in test mode; the confirmation shows the seat view.
6. Open the portal on a tablet: the booking is on Tonight with a PAID badge.

The same script runs automatically: `pnpm test:e2e tests/e2e/demo.spec.ts`.

## Commands

| Command                                              | What it does                                                                |
| ---------------------------------------------------- | --------------------------------------------------------------------------- |
| `pnpm dev` / `pnpm build` / `pnpm start`             | Next.js                                                                     |
| `pnpm typecheck`                                     | TypeScript 7 (native compiler), strict                                      |
| `pnpm lint`                                          | oxlint with type-aware rules, warnings fail                                 |
| `pnpm format` / `pnpm format:check`                  | oxfmt                                                                       |
| `pnpm test`                                          | Vitest unit and integration tests (recreates the `pyt_test` database)       |
| `pnpm test:e2e`                                      | Playwright against a production build on :3100 with its own database        |
| `pnpm screens`                                       | Device screenshot matrix into `tests/screens/__output__/matrix`             |
| `pnpm screens:portal` / `pnpm screens:3d`            | Portal screens (iPad and desktop, light and dark) and 3D room captures      |
| `pnpm venue:renders` / `pnpm venue:assets`           | Seat-view renders, and a venue's model and photos (see below)               |
| `pnpm audit`                                         | Dependency vulnerabilities (must be zero)                                   |
| `pnpm secrets`                                       | gitleaks over the whole git history                                         |
| `pnpm semgrep`                                       | Semgrep static analysis (TypeScript, React, Next.js, secrets, OWASP Top 10) |
| `pnpm db:migrate` / `pnpm db:seed` / `pnpm db:reset` | Database                                                                    |

## Stack

Next.js 16.4.2 (App Router, Turbopack, React Compiler), React 19.3.1, TypeScript 7.0.2, Node 26.12.1, Postgres 18.6 with Drizzle ORM, Tailwind CSS 4.3.3, three.js 0.186 with react-three-fiber, drei and N8AO, camera-controls, zustand, vaul, zod 4, Stripe Connect (test mode), Postmark, Cloudflare Turnstile, Vitest 5, Playwright 1.64, oxlint and oxfmt. Every dependency is pinned exactly, nothing younger than 3 days installs, and only `sharp` and `esbuild` may run install scripts.

## How it fits together

- **One venue file drives everything.** `venues/<id>/venue.json` (schema in `lib/venue/schema.ts`) is the source for the 3D scene, the 2D plan, the list and the seat renders. All positions come from `lib/venue/geometry.ts`, so the views cannot disagree; an automated layout-truth test checks it.
- **The server owns the truth.** Prices, availability and holds are computed in `lib/booking/` on the server. Postgres refuses overlapping bookings with an exclusion constraint (`db/migrations/0001_no_overlap.sql`), so double booking is impossible by construction.
- **Guest flow.** `app/v/[venue]` renders the 2D plan on the server so it paints first; the 3D diorama loads after it and fades in. The table card, hold, details, payment, confirmation and manage link live in `components/booking/`.
- **Portal.** `app/portal` with magic-link sign-in and Owner and Host roles enforced on the server.

## Adding a real venue (no code changes)

1. Write `venues/<id>/venue.json` (validated on load; `pnpm test` checks every venue folder).
2. `pnpm db:seed <id>`.
3. Render the seat views: run the app with `PYT_RENDER_ROUTE=1`, then `pnpm venue:renders <id>` (resumable; it writes AVIF, WebP and an email JPEG per table, at the 1.15 m eye height and 26 mm lens).
4. Optional: `venues/<id>/model.glb` (3 MB or less; `pnpm test` fails over budget) and photos in `venues/<id>/photos/<photoId>.jpg` with `photoId` set on the table, then `pnpm venue:assets <id>`. A photo always replaces the render.
5. The owner approves every table in Venue review and goes live.

## Stripe test mode

With no keys the app uses its simulator (`PAYMENTS_MODE=sim`), which emits Stripe-shaped, Stripe-signed webhooks so the same code paths run. To use real Stripe test mode, set in `.env.local`:

```
PAYMENTS_MODE=stripe
STRIPE_SECRET_KEY=sk_test_...
STRIPE_PUBLISHABLE_KEY=pk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...          # from: stripe listen --forward-to localhost:3000/api/stripe/webhook
STRIPE_CONNECTED_ACCOUNT_ID=acct_...     # or create one: npx tsx --conditions=react-server scripts/stripe-setup.ts
```

Then `pnpm db:seed` to attach the connected account. Charges are destination charges with a 30% application fee. Apple Pay needs the payment domain registered with Stripe on an HTTPS deployment.

## Deploying (Vercel and Neon)

1. Create a Neon Postgres 18 database and copy its pooled connection string.
2. Import the repository in Vercel. Set the environment variables from `.env.example`: `DATABASE_URL`, `APP_URL` (the production URL), `APP_SECRET` (32+ random characters), `CRON_SECRET`, and the Stripe, Postmark (`EMAIL_MODE=postmark`) and Turnstile keys. `TRUST_PROXY` defaults to `vercel` on Vercel. A production build refuses to start with Turnstile's test keys, `TRUST_PROXY=none` or `RATE_LIMIT_SCALE` above 1; for a private demo without Turnstile keys, set `PYT_TEST_DEPLOYMENT=1` and know that bots are not challenged. See `docs/SECURITY.md`.
3. Deploy. The `vercel-build` script runs the migrations, then builds. `vercel.json` schedules the hold-expiry job every minute and the nightly reconcile and retention jobs.
4. Seed once from your machine: `DATABASE_URL=<neon url> pnpm db:seed`.
5. To let a venue's website embed the widget, add its origin to `EMBED_ALLOWED_ORIGINS`.

Node: the project targets Node 26.12.1; if the host does not offer 26 yet, it runs on Node 24.22.1 LTS (`engines` allows both).

## Kill switch

`npx tsx --conditions=react-server scripts/flag.ts pyt_widget_enabled off` hides the widget within 60 seconds and shows guests how to book by phone or email. `on` restores it.
