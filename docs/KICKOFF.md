# Claude Code kickoff prompt: Pick-Your-Table prototype

**How to use:** create an empty repo, save the PRD as `docs/PRD.md`, open Claude Code in the repo, switch to plan mode, and paste everything below the line.

---

You are the founding engineer and design lead for a new product: a guest-facing restaurant table picker. A guest explores an accurate 3D model of a dining room, taps a table, sees the view from that seat, and pays a fee to guarantee it. Venues get a portal to run it from the host stand.

Your job is to build a working prototype that is the best-looking, most accurate table-booking experience on the web. Other teams have shipped 3D table pickers. We are building the one that makes theirs look unfinished. When someone sees this for the first time, they should assume a large, well-funded team built it.

## 1. Read first

Read `docs/PRD.md` end to end before writing any code. It is the source of truth for scope, requirements (P0/P1/P2), data model, policies and the fidelity bar.

- On **scope**, the PRD wins: do not add features it does not list.
- On **visual quality and craft**, this prompt raises the bar above the PRD's minimums.
- **Every product decision is already made** in the PRD's Product decisions table. Do not reopen them or wait on anyone. For implementation choices the PRD leaves open, decide, and log the choice in `docs/DECISIONS.md` with a one-line reason.

## 2. What "better" means

These are the failure patterns in existing 3D table-booking products. Each one is a bug in ours.

| Failure we have seen | What we do instead |
| --- | --- |
| Toy rooms built from primitive cylinders and boxes | Furniture at real proportions with soft bevels, real materials, ambient occlusion and contact shadows |
| Table labels printed on the tabletop, upside-down from half the camera angles | Labels always upright, screen-aligned, scale-clamped and collision-avoiding |
| Fake or random availability that changes on every render | Availability comes from the database only, and the database makes double booking impossible |
| Owner dashboards that never show the guest experience | The guest flow is the hero; the operator portal is excellent but secondary |
| Map engines used to draw indoor rooms (per-load fees, street-scale cameras) | A dedicated three.js scene with a camera tuned for rooms |
| A spinner on a blank screen while 3D loads | A crisp 2D plan paints first; 3D fades in over it |
| 3D as spectacle that does not help anyone choose | Every visual exists to answer "which table, and what will I see from it?" |
| Generic dashboard templates | A considered visual identity, typography and motion system |

## 3. Art direction: the visual bar

**The room is a living architectural diorama.**

- **Cutaway walls** about 1.1 m high, so you look into the room from above like a precise architectural model.
- **Clay materials:** one matte family of warm off-whites and stone tones, plus one venue accent color used sparingly.
- **Furniture:** real dimensions (two-top about 70 × 70 cm, chairs 45 cm seat height, booths with curved backs). Modeled with rounded edges and instanced. No raw primitives visible.
- **Windows** read as glass, with a soft hint of what lies beyond (sky gradient, a waterline). Never a fake photo backdrop.
- **Lighting:** hemisphere fill plus one soft key light. Soft contact shadows (drei `ContactShadows` or `AccumulativeShadows`), SSAO via N8AO, and AgX or ACES tone mapping. No bloom except a restrained glow on the selected table.

**Table states must read at a glance without a legend:**

| State | Treatment |
| --- | --- |
| Available | Full color, with a thin tier-colored ring on the floor |
| Hovered or focused | Subtle lift and a brighter ring |
| Selected | Lifts about 2 cm and gets a soft pool of light; every other table dims slightly |
| Taken | Desaturated to about 40% opacity, no ring |
| Wrong size for the party | Desaturated with a fine hatch ring; tapping it explains why |

**Camera**

- Default view: a three-quarter perspective at roughly 35° field of view, framing the whole room.
- Use `camera-controls` for orbit, with damping. Pitch is clamped to 25°–70°; no going under the floor or through walls.
- Tapping a table eases the camera to frame it in 400–600 ms.
- A "Sit here" action flies the camera to that seat at 1.15 m eye height, facing the table's main view, then returns.
- Respect `prefers-reduced-motion`: cut instead of fly.

**Interface**

- **Type:** a refined display serif for the venue and table names (start with Instrument Serif) and a precise grotesk for UI (start with Geist Sans). Tabular numerals for prices and times. Body text at least 16 px on mobile.
- **Color:** warm neutral surfaces plus the venue accent as tokens. Light and dark mode both designed, not inverted.
- **Bottom sheet:** the table card is a spring-physics sheet (vaul). The view photo is full-bleed. Swiping moves between available tables with the camera following.
- **Price** is always visible in the primary button ("Reserve this table - $25").
- **Motion:** 150–250 ms for UI, 400–600 ms for the camera, eased. Nothing bounces for fun.
- **Reference quality level:** Apple product pages, Airbnb's listing page, Linear. Match the craft, not the look.
- **Never:** emoji in the UI, gratuitous gradients or glassmorphism, an unmodified component-library look, placeholder or lorem ipsum copy, layout shift, default browser focus styles.

**The view from the seat is the emotional center of the product.** Until real photos exist, pre-render the view from each seat at build time with a headless browser:
- Camera at 1.15 m eye height, facing the table's main view, 26 mm full-frame equivalent field of view.
- Supersampled, with higher-quality lighting than the live scene.
- Saved as AVIF and WebP, and labeled "Preview render" in the UI.

Real photos replace renders by photo ID in `venue.json` with no code changes. Never use stock photos or AI-generated images presented as real.

## 4. Demo venue

The partner venue is not captured yet, so build against a fictional seed venue called **Halcyon**, a 20 m × 12 m waterfront dining room. Author `venue.json` to scale, in meters:

| Area | Tables | Tier | Notes |
| --- | --- | --- | --- |
| North wall, full-height windows on the water | 6 two-tops | Window | Main view faces north |
| East wall | 4 curved booths (4 seats each) | Booth | Quieter, semi-private |
| Open kitchen | Chef's counter, 3 units of 2 seats | Counter | Main view faces the kitchen pass |
| Terrace, beyond sliding doors on the west | 4 four-tops | Terrace | Outdoor |
| Main floor | 8 standard tables | Standard | Not premium; shown but not bookable |

Use these demo fees per daypart:

| Tier | Weeknight | Weekend |
| --- | --- | --- |
| Window | $25 | $40 |
| Booth | $20 | $30 |
| Counter | $15 | $25 |
| Terrace | $20 | $35 |

Mark the venue `"demo": true` and show a small "Demo venue" tag in the UI.

## 5. Stack and structure

- **Tooling:** pnpm monorepo-free single app. Next.js 15 (App Router), TypeScript strict, Tailwind CSS v4 with design tokens.
- **3D:** react-three-fiber, drei, @react-three/postprocessing (N8AO), camera-controls, troika-three-text or HTML overlays for labels.
- **State:** zustand holds selection and slot. The 3D plan, 2D SVG plan and list view share it and stay in sync.
- **Schema:** `venue.json` validated with zod. Both renderers read only from it.
- **Data:** Postgres via docker compose locally, Drizzle ORM, the `btree_gist` extension and the exclusion constraint from the PRD.
- **Payments:** Stripe Connect in test mode with a test connected account; destination charges with an application fee; webhooks via the Stripe CLI locally.
- **Adapters:** email (Postmark adapter; dev writes to a `/dev/mail` inbox page), analytics (PostHog adapter; dev logs to console), Turnstile (test keys).
- **Tests:** Vitest for unit, Playwright for end-to-end and screenshots.
- **Flag:** `pyt_widget_enabled` kill switch.

Suggested layout:

```
app/(guest)/v/[venue]/          guest widget
app/(operator)/portal/          operator portal
app/api/                        holds, checkout, webhooks, availability
lib/venue/                      schema, loaders, seed venue.json
lib/booking/                    availability, pricing, holds (server only)
components/room/                3D scene, 2D plan, list view, labels, camera
components/ui/                  design system
db/                             drizzle schema, migrations, seed
tests/                          vitest, playwright, screenshot specs
docs/                           PRD.md, DECISIONS.md, BUILD_PLAN.md
```

## 6. Milestones

Work in this order, matching the PRD's Build sequence. Close each milestone with its own check, write a short report (what shipped, screenshots, open issues, decisions logged), then continue without waiting for approval.

**M0: Foundations**
- Write `docs/BUILD_PLAN.md`.
- Set up the repo with lint, format and typecheck in CI.
- Define the `venue.json` schema and author the Halcyon seed.
- Set up the database with the exclusion constraint, and seed it.
- Set up a deploy pipeline to a preview URL.

*Done when* `pnpm dev`, `pnpm test` and `pnpm typecheck` pass from a clean clone with one documented setup command, CI is green, and a preview URL deploys.

**M1: The room (the hero milestone; give it the most time)**
- 2D SVG plan, list view and 3D scene, all from `venue.json` and kept in sync.
- Table states, upright labels, camera framing, "Sit here" fly-to, and the preview renders.
- 2D paints first, then 3D fades in.

*Done when* the screenshot loop (section 7) passes at 390 × 844 and 1440 × 900 in light and dark mode, and these budgets hold:
- 2D interactive in 2.5 s or less on Fast 4G emulation.
- Initial JavaScript 250 KB compressed or less.
- 60 fps orbiting on a mid-range laptop.

**M2: Book a table, end to end**
- Slot picker and availability API.
- Table card with swipe-to-compare.
- 8-minute hold with countdown, plus the PRD's race handling and "most similar table" fallback.
- Stripe checkout (Apple Pay, Google Pay, card), confirmation screen, and email with photo and .ics.
- Manage link with policy refund.
- Every guest state from the PRD's state table.

*Done when* the PRD's demo script runs end to end in test mode in under 90 seconds on an iPhone-sized viewport.

**M3: Operator portal**
- Magic-link sign-in, with Owner and Host roles.
- Tonight, Bookings, Tables and pricing, and Blackouts screens.
- Venue review screen (P1).
- Tablet-first layout with the same design quality as the guest side.

*Done when* a booking made on the guest side appears on Tonight with a PAID badge within 2 s.

**M4: Hardening and proof**
- Concurrency test: 20 scripted races, 0 double bookings.
- Axe reports zero WCAG 2.2 AA violations, and the whole flow works with WebGL disabled.
- Lighthouse budgets met.
- Playwright screenshot matrix: iPhone 13, Pixel 6a, Galaxy A35, iPad, desktop Chrome and Safari.
- Red-team tests from the PRD's Privacy and security section.
- Structured logs for every hold, payment, webhook and refund.
- Kill switch verified.
- P1 requirements.
- README with setup and the demo script.

*Done when* every P0 acceptance check in the PRD passes, and `docs/GATE_REPORT.md` is written against the PRD's build gate, with a proof for each check and a one-line recommendation: invest further, or stop.

## 7. Working agreements

- **Plan first.** Produce `docs/BUILD_PLAN.md`, then build straight through.
- **You are the gate.** No human approval between milestones; the PRD's checks decide when a milestone is done.
- **Visual bugs are P0.** If it looks wrong, the project ends.
- **Screenshot loop.** After any visual change:
  1. Run the Playwright screenshot spec.
  2. Open the PNGs and critique them as a world-class product designer would.
  3. List what is off (alignment, spacing, type, contrast, shadow quality, label legibility, motion jank).
  4. Fix it and repeat.
  5. Do at least three passes on M1 before calling it done.
- **Server-side truth.** Prices, availability and holds are computed on the server. The client never decides what something costs or whether it is free.
- **No placeholders in shipped UI.** Every string is real copy.
- **Log decisions.** Any choice the PRD leaves open goes in `docs/DECISIONS.md` with a one-line reason.
- **Commit at each working step** with a clear message.
- **Scope order.** Ship every P0 before any P1. P2 is out.

**The bar to hold yourself to:** a guest picks a table in under a minute, sees exactly what they will see from that seat, pays without friction, and walks in to find the room just as the screen showed it. Build that, and make it beautiful.
