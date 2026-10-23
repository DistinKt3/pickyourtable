# Build plan

The PRD (`docs/PRD.md`) is the source of truth for scope. The kickoff (`docs/KICKOFF.md`) sets the visual bar. Implementation choices the PRD leaves open are logged in `docs/DECISIONS.md`. This file is how the build is organized: the architecture, the contracts between parts, who owns which files, and how each milestone is checked.

## Stack (latest stable, checked 2026-10-23)

Next.js 16.4.2 (App Router, Turbopack, React Compiler), React 19.3.1, TypeScript 7.0.2 (native compiler), Node 26.12.1 (24.22.1 LTS fallback), pnpm 12.15.0, Postgres 18.6, Drizzle ORM 0.45.4, Tailwind CSS 4.3.3, three 0.186.1 with react-three-fiber 9.8.2, drei 10.7.9, postprocessing 6.39.5 and @react-three/postprocessing 3.2.1 (N8AO), camera-controls 3.1.2, zustand 5.0.15, vaul 1.1.2, zod 4.6.7, Stripe 23.0.0, Postmark 5.1.0, Vitest 5.0.5, Playwright 1.64.1, oxlint 1.89.0 and oxfmt 0.74.0.

Supply chain: exact pins, a committed lockfile, a 3-day minimum release age, and install scripts allowed only for `sharp` and `esbuild` (`pnpm-workspace.yaml`). `pnpm audit` must report zero vulnerabilities at every milestone.

## Commands

| Command | What it does |
| --- | --- |
| `pnpm run setup` | One-command setup from a clean clone: `.env.local`, install, Postgres 18 in Docker, migrate, seed |
| `pnpm dev` | Dev server on :3000 |
| `pnpm typecheck` / `pnpm lint` / `pnpm format:check` | Fast checks |
| `pnpm test` | Vitest: unit and integration (recreates the `pyt_test` database each run) |
| `pnpm test:e2e` | Playwright against a production build on :3100 with its own database (`pyt_e2e`), phone (390 x 844) and desktop (1440 x 900). One run at a time: the port is fixed. `E2E_SKIP_BUILD=1` reuses the last build |
| `pnpm screens` / `pnpm screens:portal` | The screenshot loop for the guest widget, and for every portal screen at iPad and desktop sizes, light and dark |
| `pnpm audit` / `pnpm secrets` / `pnpm semgrep` | Dependency audit, gitleaks over the git history, Semgrep's TypeScript, React, Next.js, secrets and OWASP rule sets. All must report nothing |
| `pnpm flag pyt_widget_enabled off` | The kill switch (PRD S-5); `on` restores |
| `pnpm reconcile` | Compares every booking's money with the payment provider |

## Architecture

```
venues/<id>/venue.json        the venue (geometry, tiers, booking config); validated by lib/venue/schema.ts
public/venues/<id>/           renders/, photos/, model.glb (media served from the CDN)
lib/venue/                    schema, loader, geometry (shared by every renderer), media URLs
lib/room/                     RoomData types and the zustand store shared by 3D, 2D and list
lib/api/contracts.ts          zod schemas for every HTTP request and response
lib/booking/                  slots, pricing, availability, holds, checkout, refunds, operations (server only)
lib/payments/                 Stripe adapter and the local Stripe simulator (server only)
lib/email/                    email adapter (dev store, Postmark) and templates
lib/auth/                     magic links, sessions, roles
lib/security/                 HMAC and tokens, origin checks, rate limits, Turnstile, client identity
lib/http/api.ts               the wrapper every route handler uses
db/                           Drizzle schema, migrations (0001 has the no-overlap constraint), seed
proxy.ts                      nonce CSP and per-route framing rules (headers only, never auth)
app/v/[venue]/                guest widget, confirmation, manage page
app/portal/                   operator portal
app/api/                      route handlers
components/ui/                design system
components/room/plan2d/       2D SVG plan (paints first; also the no-WebGL view)
components/room/scene3d/      3D diorama (loaded after the 2D plan)
components/booking/           guest flow UI, including the list view (list-view.tsx) and the table card
components/portal/            portal UI
app/demo/[venue]/route.ts     a plain-HTML stand-in for a venue's own website, using the one-line embed
tests/unit, tests/integration Vitest
tests/e2e                     Playwright: demo script, guest states, a11y and type size, budgets, layout truth,
                              kill switch, portal, timed PRD checks (requirements.spec.ts), screenshots
```

Server truth: prices, availability and holds are computed only on the server. The client never sends a price; if it did, it would be ignored.

### Coordinates

x grows east, z grows south (north is -z), origin at the north-west interior corner, meters. Compass angles are clockwise from north. Three.js uses the same x and z, with y up; an object facing compass bearing `b` has `rotation.y = -b` in radians (`rotationY()` in `lib/venue/geometry.ts`). Every renderer gets positions from `lib/venue/geometry.ts`; nothing re-derives them.

### Guest state

`lib/room/store.ts` (`useRoom`) holds the view (room or list), the renderer (pending, 3d or 2d), party, slot, availability by table code, hovered, selected, sitting, and a camera intent (`overview`, `frame`, `sit`) with a fresh id per request. The 3D scene, 2D plan and list read and write only this store.

### Venue data pipeline (PRD D-1, D-2, D-3)

1. Add `venues/<id>/venue.json` (schema-validated; see `lib/venue/schema.ts`).
2. `pnpm db:seed <id>` loads venue, tables, prices and turn times.
3. `pnpm venue:renders <id>` renders each bookable table's seat view in headless Chromium and writes AVIF, WebP and an email JPEG to `public/venues/<id>/renders/`.
4. Optional: put `model.glb` (3 MB or less) in `venues/<id>/` and real photos in `venues/<id>/photos/<photoId>.jpg`, set `photoId` on the table, run `pnpm venue:assets <id>`. A photo always wins over a render.
5. The owner approves every table in Venue review, then goes live.

No code changes at any step.

## Ownership during the parallel build

The lead integrates, pushes and runs the gates. Each stream works in its own git worktree, commits there, and does not push. A file belongs to one stream; anything outside it is read-only for that stream.

| Stream | Owns | Database and port |
| --- | --- | --- |
| Lead | `lib/venue/**`, `lib/room/**`, `lib/api/contracts.ts`, `lib/security/**`, `lib/http/**`, `lib/auth/**`, `lib/env.ts`, `db/schema.ts`, `db/migrations/0000-0001`, `proxy.ts`, `next.config.ts`, `components/ui/**`, `components/room/plan2d/**`, `components/room/list/**`, `components/booking/**`, `app/v/**`, `app/layout.tsx`, `app/globals.css`, `public/embed.js`, `tests/e2e/**`, `playwright.config.ts`, `package.json`, docs | `pyt`, `pyt_test`, :3000 |
| Booking server | `lib/booking/**` (including the bodies in `operations.ts`), `lib/payments/**`, `lib/email/templates/**`, `app/api/v/**`, `app/api/holds/**`, `app/api/sim/**`, `app/api/stripe/**`, `app/api/manage/**`, `app/api/jobs/**`, `app/dev/mail/**`, `instrumentation.ts`, `db/migrations/0002+`, `scripts/{flag,reconcile,stripe-setup}.ts`, `tests/unit/booking/**`, `tests/integration/booking/**` | `pyt_dev_a`, `pyt_test_a`, :3101 |
| 3D room | `components/room/scene3d/**`, `app/render/**`, `app/dev/room/**`, `scripts/render-seat-views.ts`, `scripts/venue-assets.ts`, `scripts/screens-3d.ts`, `public/venues/*/renders/**`, `public/vendor/**`, `tests/unit/room/**` | `pyt_dev_b`, :3102 |
| Portal | `app/portal/**`, `app/api/portal/**`, `components/portal/**`, `lib/portal/**`, `tests/integration/portal/**` | `pyt_dev_c`, `pyt_test_c`, :3103 |

Rules for every stream:

- Do not edit files you do not own. If a contract (`lib/api/contracts.ts`, `db/schema.ts`, `lib/room/store.ts`) needs a change, make the smallest additive change, and list it in your report.
- Do not add dependencies or edit `package.json`; list any script or dependency you need in your report. Every dependency already installed is listed in `package.json`.
- Every route handler uses `api()` from `lib/http/api.ts`. Mutations are same-origin checked there.
- No placeholder copy, no emoji, no TODOs in shipped code. Use the design system in `components/ui/` and the tokens in `app/globals.css`.
- Fast checks before each commit: `pnpm typecheck`, `pnpm lint`, and the Vitest files you own.

## Milestones and checks

| Milestone | Done when |
| --- | --- |
| M0 Foundations | Clean clone works with `pnpm run setup`; typecheck, lint, unit tests and build pass; audit clean; schema and seed in place; CI workflow committed |
| M1 The room | 3D, 2D and list from one source; table states; labels; camera; Sit here; seat renders; screenshot loop passes three times at 390 x 844 and 1440 x 900, light and dark; layout-truth test; budgets measured |
| M2 Book a table | Demo script runs end to end in sim mode in under 90 s at phone size; every guest state reachable and tested |
| M3 Operator portal | A guest booking appears on Tonight with a PAID badge within 2 s |
| M4 Hardening | 20 races, 0 double bookings; red-team tests; axe clean with WebGL off; kill switch; logs; P1s; `docs/GATE_REPORT.md` |

The screenshot loop: run the screenshot spec, review every image as a demanding product designer, fix what is off, repeat.
