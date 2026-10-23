# Pick-Your-Table (prototype)

A guest explores an accurate 3D model of a dining room, taps a table, sees the view from that seat, and pays a fee to guarantee it. The venue runs it from a tablet portal at the host stand. Pick-Your-Table is the internal codename: guests only ever see the venue's name, colors and type.

This is the working prototype described in [`docs/PRD.md`](docs/PRD.md). Where it stands against the PRD's build gate is in [`docs/GATE_REPORT.md`](docs/GATE_REPORT.md), with a [demo recording](docs/gate/demo-phone.mp4) and [screenshots](docs/gate/screens/).

## Run it on a Mac in 5 minutes

You need Homebrew ([brew.sh](https://brew.sh)). Everything else installs below. Paste each block into Terminal as it is.

**1. Install the tools (once).**

```bash
brew install git node pnpm
brew install --cask docker
open -a Docker
```

Wait until Docker Desktop says it is running (the whale icon in the menu bar stops animating). Any Docker that provides `docker compose` works, such as OrbStack.

**2. Get the code.**

```bash
cd ~
git clone -b main https://github.com/DistinKt3/pickyourtable.git
cd pickyourtable
```

**3. Set up and start.**

```bash
pnpm run setup
pnpm dev
```

`pnpm run setup` takes a few minutes the first time. It creates `.env.local` with fresh secrets, installs the dependencies, starts Postgres 18 in Docker, creates the tables and loads two demo venues. Run it once. After that, `pnpm dev` is all you need, as long as Docker is open.

**4. Open the app.** Keep the terminal running `pnpm dev` open.

| Open                                                                  | What it is                                                             |
| --------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| [localhost:3000/v/halcyon](http://localhost:3000/v/halcyon)           | The guest widget for the demo venue Halcyon                            |
| [localhost:3000/v/orchard-room](http://localhost:3000/v/orchard-room) | A second venue with a different layout, time zone and tiers            |
| [localhost:3000/demo/halcyon](http://localhost:3000/demo/halcyon)     | A stand-in for the venue's own website, with the one-line embed button |
| [localhost:3000/portal](http://localhost:3000/portal)                 | The venue portal (sign in below)                                       |
| [localhost:3000/dev/mail](http://localhost:3000/dev/mail)             | The dev inbox: every email the app sends, including sign-in links      |

To stop, press `Control-C` in the terminal. To run it again later, open Docker, then run `pnpm dev` from the `pickyourtable` folder.

## Try the demo

1. Open [localhost:3000/v/halcyon](http://localhost:3000/v/halcyon). The 2D plan appears first and the 3D room fades in over it. A phone-sized window shows the phone layout: in Chrome, View → Developer → Developer Tools, then the device toolbar.
2. Tap **Choose a time** (on a wide screen, the date and time at the top), and pick a Friday, 8:00 pm, party of 2.
3. Tap **Window 1**: the card shows the view from that seat. Tap **Sit here**, then **Back to the room**. Swipe the card, or use its arrows, to compare Booth 2.
4. Tap **Reserve this table**. Enter any name, an email and a mobile number, choose **Apple Pay** (a test wallet), and pay. Nothing is charged: payments run against a built-in Stripe simulator, and the app refuses real (live) Stripe keys.
5. The confirmation shows the seat view. The confirmation email, with a calendar file and a manage link to cancel, is in the [dev inbox](http://localhost:3000/dev/mail).

**The venue portal:**

1. Open [localhost:3000/portal](http://localhost:3000/portal) and sign in as `owner@halcyon.example`, or `host@halcyon.example` for the Host role.
2. Open the [dev inbox](http://localhost:3000/dev/mail), open the sign-in email, click its link, then **Sign in to Halcyon**.
3. **Tonight** shows today's paid bookings, with Seated and No-show. To see the booking you just made, pick its date with the date arrows. The portal also has **Bookings** (search, cancel and refund), **Tables and pricing**, **Blackouts** and **Venue review**. The Owner sees every section; the Host sees Tonight and Bookings.

**Good to know:**

- Without a usable graphics card the app stays on the 2D plan, by design. `?room=3d` forces the 3D room, for example [localhost:3000/v/halcyon?room=3d](http://localhost:3000/v/halcyon?room=3d).
- `pnpm db:reset` puts the venues' tables, prices and turn times back to the demo values. To start completely fresh, including bookings, run `docker compose down -v`, then `pnpm run setup`.

## If something goes wrong

| You see                                                | Do this                                                                                                                                                                          |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `No package.json … found` or `Command "dev" not found` | You are not in the project folder. Run `cd ~/pickyourtable`, then try again.                                                                                                     |
| `zsh: command not found: pnpm` (or `node`, `git`)      | Run `brew install git node pnpm`.                                                                                                                                                |
| `Docker is installed but not running`                  | Open Docker Desktop, wait until it is running, then run `pnpm run setup` again.                                                                                                  |
| `Node 24.22+ or 26.12+ is required`                    | Run `brew upgrade node`.                                                                                                                                                         |
| `Port 3000 is in use, trying 3001 instead`             | The app still runs, on the port it names. Sign-in links point at 3000, so either stop the other app and restart `pnpm dev`, or change `APP_URL` in `.env.local` to the new port. |
| You want to start over                                 | Run `docker compose down -v`, then `pnpm run setup`. This deletes the local database.                                                                                            |
| Anything else                                          | Run `pnpm run setup` again. It is safe to repeat and keeps your `.env.local`.                                                                                                    |

## Tests and checks

| Command                                                    | What it does                                                                                                                                              |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm test`                                                | Vitest unit and integration tests, against a throwaway database (Docker must be running)                                                                  |
| `pnpm test:e2e`                                            | Playwright browser tests against a production build on :3100 with its own database. The first time on a Mac, run `pnpm exec playwright install chromium`. |
| `pnpm typecheck` / `pnpm lint` / `pnpm format:check`       | TypeScript 7 (strict), oxlint with type-aware rules, oxfmt                                                                                                |
| `pnpm audit` / `pnpm secrets` / `pnpm semgrep`             | Dependency audit, gitleaks over the git history, Semgrep. All must report nothing.                                                                        |
| `pnpm screens` / `pnpm screens:portal` / `pnpm screens:3d` | Screenshot sets for design review                                                                                                                         |
| `pnpm build` / `pnpm start`                                | A production build and server                                                                                                                             |
| `pnpm db:migrate` / `pnpm db:seed` / `pnpm db:reset`       | Database                                                                                                                                                  |
| `pnpm flag pyt_widget_enabled off`                         | The kill switch: within 60 s guests see how to book by phone or email instead. Use `on` to restore it.                                                    |

The browser tests run in four projects: `phone` and `desktop` with WebGL off (booking, portal, embed and timings), and `phone-3d` and `desktop-3d` for the 3D room. The demo script runs in all four: `pnpm test:e2e tests/e2e/demo.spec.ts`.

## What's inside

**Stack.** All latest stable releases, pinned exactly:

- Next.js 16.4 (App Router, React Compiler) and React 19.3
- TypeScript 7 on Node 26 (Node 24.22 LTS also works)
- Postgres 18 with Drizzle
- Tailwind CSS 4
- three.js with react-three-fiber
- zod 4, Stripe and Postmark
- Vitest 5 and Playwright 1.64

Nothing younger than 3 days installs, and only `sharp` and `esbuild` may run install scripts.

**How it fits together:**

- **One venue file drives everything.** `venues/<id>/venue.json` (schema in `lib/venue/schema.ts`) is the source for the 3D room, the 2D plan, the list and the seat views. Every position comes from `lib/venue/geometry.ts`, and a test checks that the three views agree.
- **The server owns the truth.** Prices, availability and holds are computed in `lib/booking/`. Postgres refuses overlapping bookings with an exclusion constraint (`db/migrations/0001_no_overlap.sql`), so a double booking is impossible.
- **Guest flow.** `app/v/[venue]` renders the 2D plan on the server, so it paints first; the 3D room (`components/room/scene3d/`) loads after it and fades in. The card, hold, payment, confirmation and manage link are in `components/booking/`.
- **Portal.** `app/portal`, with magic-link sign-in and the Owner and Host roles enforced on the server.

**The docs:**

- [`docs/BUILD_PLAN.md`](docs/BUILD_PLAN.md): how it is built
- [`docs/DECISIONS.md`](docs/DECISIONS.md): every judgment call
- [`docs/SECURITY.md`](docs/SECURITY.md): security controls and remaining risks
- [`docs/GATE_REPORT.md`](docs/GATE_REPORT.md): what was verified, and what still needs real devices or people

## Adding a real venue (no code changes)

1. Write `venues/<id>/venue.json`. It is validated on load, and `pnpm test` checks every venue folder.
2. Run `pnpm db:seed <id>`.
3. Render the seat views: start the app with `PYT_RENDER_ROUTE=1 pnpm dev`, then run `pnpm venue:renders <id>`. The run is resumable. It writes AVIF, WebP and an email JPEG for each table, at the 1.15 m eye height with a 26 mm lens.
4. Optional:
   - Add a model at `venues/<id>/model.glb` (3 MB or less; `pnpm test` fails over budget).
   - Add photos at `venues/<id>/photos/<photoId>.jpg` and set `photoId` on each table.
   - Then run `pnpm venue:assets <id>`. A photo always replaces the render.
5. The owner approves every table in Venue review, then goes live.

## Stripe test mode

With no keys, the app uses its simulator (`PAYMENTS_MODE=sim`). It sends Stripe-shaped webhooks, signed the way Stripe signs them, so the same code runs either way. To use real Stripe test mode, add these to `.env.local`:

```
PAYMENTS_MODE=stripe
STRIPE_SECRET_KEY=sk_test_...
STRIPE_PUBLISHABLE_KEY=pk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_CONNECTED_ACCOUNT_ID=acct_...
```

- **Webhook secret:** run `stripe listen --forward-to localhost:3000/api/stripe/webhook`; it prints the secret.
- **Connected account:** `pnpm stripe:setup` creates a test one.
- **Then:** run `pnpm db:seed` to attach the account, and `pnpm reconcile` to check money against Stripe.

Charges are destination charges with a 30% application fee. Apple Pay needs the payment domain registered with Stripe on an HTTPS deployment.

## Deploying (Vercel and Neon)

1. Create a Neon Postgres 18 database and copy its pooled connection string.
2. Import the repository in Vercel and set the environment variables from `.env.example`:
   - `DATABASE_URL`
   - `APP_URL` (the production URL)
   - `APP_SECRET` (32 or more random characters)
   - `CRON_SECRET`
   - the Stripe, Postmark (`EMAIL_MODE=postmark`) and Turnstile keys

   `TRUST_PROXY` defaults to `vercel` on Vercel. A production build refuses to start with Turnstile's test keys, `TRUST_PROXY=none`, or `RATE_LIMIT_SCALE` above 1. For a private demo without Turnstile keys, set `PYT_TEST_DEPLOYMENT=1`, and know that bots are not challenged. See [`docs/SECURITY.md`](docs/SECURITY.md).

3. Deploy. The `vercel-build` script runs the migrations, then builds. `vercel.json` schedules the hold-expiry job every minute and the nightly reconcile and retention jobs.
4. Seed once from your machine: `DATABASE_URL=<neon url> pnpm db:seed`.
5. To let a venue's website embed the widget, add its origin to `EMBED_ALLOWED_ORIGINS`.
