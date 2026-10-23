# Build gate report

**Date:** 2026-10-23. **Build:** branch `claude/vigilant-darwin-1zs4u4`. **Environment:** a cloud Linux container with 4 vCPUs. Chromium runs headless with SwiftShader, a software GPU, and the database is Postgres 18.6 in Docker. Payments use the local Stripe simulator (`PAYMENTS_MODE=sim`), email uses the dev mail store, and Turnstile uses Cloudflare's documented test keys. There is no deployment.

**Recommendation: invest further.** Every check that can run here passes, each with its proof. The gate is not complete until four more things run: the device matrix with on-device frame rate, the demo on a real phone, usability with five people, and an outside design review. Money reconciliation also needs one run in Stripe test mode. Stop if on-device frame rate or usability fails.

The PRD's gate has eight checks. Every check that a machine can run was run here, and each result below names its proof. Four checks need people, real devices or a live Stripe account, and this environment has none of those. They are marked **not run** with what they need. Under the PRD's own rule, the gate is only complete when they pass.

## The gate

| Check | Result | Proof |
| --- | --- | --- |
| **Requirements:** every P0 acceptance check passes, with proof | **Pass here** for every P0 and P1. Four qualifications: G-1's 3D time needs a real GPU; G-5's move time comes from a unit test; G-7, G-8, G-9, O-2 and S-3 ran against the Stripe simulator and the dev mail store; and D-2's compressed models are untested. | The requirements table below |
| **Quality bar** on the device matrix, zero open visual defects | Partly run | Automated rows pass (layout truth, labels, seat-view math, type size, accessibility, speed in Chromium). Screenshots at 390 x 844 and 1440 x 900 in light and dark are below, with the open visual notes. The device matrix (iPhone 13, iPhone 16 Pro, Pixel 6a, Galaxy A35, iPad, desktop Safari) and on-device frame rate are **not run**: no real devices here. |
| **Demo script** under 90 s on a real phone, three times without a defect | Run in Chromium at phone size; **not run on a real phone** | `tests/e2e/demo.spec.ts`. With the plan view, three runs in a row at each size: 9.0, 8.2 and 8.6 s on the phone; 6.9, 6.8 and 6.7 s on the desktop. In the 3D room the script also completes, in 101 s (phone) and 81 s (desktop). That time measures the software GPU, which draws a frame every few seconds, not the script. The recording is [`gate/demo-phone.mp4`](gate/demo-phone.mp4), with a four-step contact sheet in [`gate/demo-phone-steps.jpg`](gate/demo-phone-steps.jpg). |
| **Concurrency:** 20 races, 20 single winners, 0 double bookings | **Pass** | `20 rounds of 10 concurrent holds: exactly one wins each round, the rest get the most similar table` and `150 simultaneous holds across 5 tables: one winner per table` (`tests/integration/booking/holds.test.ts`). The database's exclusion constraint makes a double booking impossible, not just unlikely (`the database itself refuses an overlapping booking (S-2)`). |
| **Money:** 20 bookings, cancellations, refunds and expired holds reconcile to the cent in Stripe | **Pass against the simulator; not run against Stripe** | `20 bookings, cancellations, refunds and expired holds match the provider exactly` (`tests/integration/booking/money.test.ts`). The simulator is Stripe-shaped and signs its webhooks the way Stripe does, so the same code runs in both modes. Running the same check in Stripe test mode needs test keys: `pnpm stripe:setup`, then `pnpm reconcile`. |
| **Usability:** 5 first-time people find a window table and its seat view in 10 s, and book in 90 s, unaided | **Not run** | Needs five people. The script is in the PRD; record each session's times here. |
| **Data contract:** a second venue with a different layout loads, renders and books with no code change | **Pass** | Orchard Room (New York, a garden, banquettes, a bar, brunch) loads (`validates every venue folder`), draws in 2D, 3D and the list exactly where its `venue.json` says (`orchard-room: 2D plan, 3D scene and list agree with venue.json`), and books end to end (`data contract: the second venue loads, renders and books with no code change`). |
| **Design review:** an outside senior product designer would ship the recorded demo | **Not run** | Needs the designer. The screenshot sets below and the demo recording are ready for them. |

## Requirements (P0 and P1)

| ID | Requirement | Priority | Result | Proof |
| --- | --- | --- | --- | --- |
| G-1 | Plan loads from the venue URL: 2D interactive in 2.5 s or less on Fast 4G (iPhone 13 profile), 3D within 4 s | P0 | **Pass for 2D** (1.5 to 1.7 s). **3D not measurable here**: 8.3 to 9.1 s on a software GPU. | `tests/e2e/budgets.spec.ts` (see Speed and size) |
| G-2 | Every table shows available, taken or wrong size within 500 ms of a change | P0 | **Pass**: 47 ms | `G-2: a change of time shows every table's state within 500 ms` (`tests/e2e/requirements.spec.ts`), measured in the page from the tap to the changed state |
| G-3 | Table card: seat view, tier, up to 3 attributes, seats and the server-computed fee | P0 | **Pass** | `tests/e2e/demo.spec.ts` (the Window 1 card with its seat view and "Reserve this table – $40"); fees from `answers every table with its state, server fee and a plain reason`; at most 3 attributes enforced by `refuses more than 3 attributes` |
| G-4 | Swiping the open card shows the next available table and moves the camera without closing the sheet | P0 | **Pass** | `tests/e2e/demo.spec.ts` (swipe to Booth 2 and back, the sheet stays open); camera framing in `tests/unit/room/camera.test.ts` |
| G-5 | Sit here: the camera reaches the seat at 1.15 m in 400 to 600 ms and returns; with reduced motion it cuts | P0 | **Pass**; the move time comes from the unit test, and on-device timing is not run | `tests/unit/room/camera.test.ts` (eye height, lens, transition time, the reduced-motion cut); `tests/e2e/demo.spec.ts` (Sit here, then Back to the room) |
| G-6 | Two guests holding the same table and slot within 1 s: exactly one succeeds, the other sees the most similar free table | P0 | **Pass** | `20 rounds of 10 concurrent holds: exactly one wins each round, the rest get the most similar table`; in the browser, `taken between viewing and holding: told plainly and offered the most similar table` |
| G-7 | A booking is confirmed only after Stripe reports success | P0 | **Pass (simulator)** | `confirms only after the provider reports success, then emails the guest and the venue (G-8, O-5)`; `failed then succeeded, delivered in either order, ends confirmed with no error`; `a replayed event confirms once and sends one email` |
| G-8 | Email with the seat view and a calendar file arrives within 60 s of payment | P0 | **Pass (dev mail store)** | `confirms only after the provider reports success, then emails the guest and the venue`; `the confirmation carries the seat view, details, policy and manage link`; `serves the calendar file`; RFC 5545 tests in `tests/unit/booking`. Delivery through Postmark is not run (no token). |
| G-9 | The refund amount shows before the guest confirms a cancellation, and the provider shows the matching refund | P0 | **Pass (simulator)** | `refund preview and actual refund agree: full at 24 hours or more` and `… none under 24 hours` |
| G-10 | With WebGL off the whole flow completes; axe reports zero WCAG 2.2 AA violations | P0 | **Pass** | `the whole booking flow works without WebGL and passes axe at every step` (phone and desktop); with 3D on as well: `with the 3D room up: axe passes and every table is reachable exactly once` |
| G-11 | From a table card, the next 5 free slots for that table | P1 | **Pass** | `finds the next free times for one table, across days (G-11)`; the card's "Find other times for this table" |
| G-12 | One script tag adds the button and opens the widget full screen; checkout works from it | P1 | **Pass in Chromium** | `G-12: one script tag adds the button; the widget opens full screen and checkout works`; `G-12 fallback: from the embed, the same hold continues in a new tab on our site` (the PRD's top-level checkout for wallets that are hidden inside frames). Apple Pay in a Safari iframe is **not run**. |
| O-1 | Every paid booking for today shows on the plan and list with a PAID badge; Seated and No-show update in under 2 s | P0 | **Pass** | `a guest booking appears on Tonight with a PAID badge within 2 seconds` (a real guest booking in another browser); `O-1: Seated and No-show update Tonight in under 2 s`; `Tonight lists every paid booking for the date and the state of each table` |
| O-2 | An owner refund appears at the provider and emails the guest within 60 s | P0 | **Pass (simulator)** | `a venue cancellation refunds in full and emails the guest and the venue`; Owner-only in `only an Owner cancels with a refund, and the reason reaches the operation` |
| O-3 | A fee change applies to new holds only; existing bookings keep their price | P0 | **Pass** | `a fee change applies to new holds only`; `stores a dollar fee as exact cents and writes an audit row with before and after` |
| O-4 | A blacked-out table shows as taken to guests within 10 s | P0 | **Pass** | `O-4: a blackout the owner adds shows as taken to a guest within 10 s` (an owner adds it in one browser; a guest watching in another sees it change); `a table blackout shows the table as taken and refuses a hold on it` |
| O-5 | Booking and cancellation emails to the venue within 60 s | P1 | **Pass (dev mail store)** | `confirms only after the provider reports success, then emails the guest and the venue (G-8, O-5)`; `a venue cancellation refunds in full and emails the guest and the venue` |
| O-6 | The venue cannot go live until every table is approved | P1 | **Pass** | `refuses to go live while a table is unapproved, then allows it once all are approved` |
| D-1 | `venue.json` is schema-validated; a second fixture venue loads with no code change | P0 | **Pass** | `validates every venue folder`; `rejects duplicate ids, unknown tiers and impossible party ranges`; the data contract check above |
| D-2 | If a venue ships a GLB, the scene uses it; otherwise it builds the room from `venue.json` | P1 | **Partly**: the GLB path is proven on the dev page with an uncompressed model; meshopt and KTX2 compression are not exercised (no encoder here) | `venueModelUrl` and the scene's model loader (`components/room/scene3d/ModelShell.tsx`, KTX2 and meshopt); `every venue model is within the 3 MB budget (D-2)` fails CI over budget. Neither fixture venue ships a model, so the built room is what runs. |
| D-3 | Adding a photo id to a table swaps the seat view with no code change | P0 | **Pass** | `uses the render until a photo id is set, then the photo, in the room and in email` (`tests/integration/venue/photo.test.ts`) |
| S-1 | A tampered client price is ignored; the charge equals the server price | P0 | **Pass** | `price-like fields from the client are ignored; the charge is the server price (S-1)` |
| S-2 | A database constraint rejects any overlapping hold or booking | P0 | **Pass** | `the database itself refuses an overlapping booking (S-2)`; `db/migrations/0001_no_overlap.sql` |
| S-3 | If the table was re-held, a late payment is refunded within 5 min and the guest is emailed | P0 | **Pass (simulator)** | `is refunded in full at once, with an email, when the table was held again (webhook path)`; `refunded before succeeded: the job refunds first, then both events arrive in reverse order` |
| S-4 | At most 2 active holds per device and per email; Turnstile before a hold | P0 | **Pass** | `a bot holding every premium table from one device is stopped after 2`; `concurrent holds from one device cannot pass the limit together`; `at most 2 active holds per email`; `a hold without a Turnstile token, or with a failed check, is refused` |
| S-5 | Turning off `pyt_widget_enabled` hides the widget within 60 s and shows a fallback | P0 | **Pass** | `kill switch hides the widget and refuses guest APIs, then restores` (`tests/e2e/kill-switch.spec.ts`); `the kill switch stops guest routes with a plain message, but never payment webhooks (S-5)` |
| S-6 | Every hold, payment, webhook and refund writes one log line with IDs, amounts and outcome | P0 | **Pass** | `a hold, its payment, the webhooks and a refund each write one line with ids, amounts and outcome` (`tests/integration/booking/logs.test.ts`) |
| G-13, O-7 | Daypart lighting; payouts screen | P2 | Not in scope | The PRD leaves both unspecified for this prototype. |

## Speed and size (Chromium, iPhone 13 profile, Fast 4G, CPU slowed 4x)

| Budget | Target | Measured | Result |
| --- | --- | --- | --- |
| 2D plan interactive | 2.5 s or less | 1.5 to 1.7 s | **Pass** |
| First contentful paint | — | 0.8 to 0.9 s | — |
| JavaScript before the plan is interactive, compressed | 250 KB or less | 197.7 KB in 9 files | **Pass** |
| 3D room ready | 4 s or less | 8.3 to 9.1 s on a software GPU | Not measurable here |
| 3D room code, loaded after the plan is interactive | — | 388.8 KB compressed: three and the scene 249.7 KB, effects and ambient occlusion 120.0 KB, camera controls 19.1 KB | — |
| Draw calls | Under 120 | Overview 72 (Halcyon) and 49 (Orchard Room); 78 and 53 with availability; 33 to 40 with a table framed; 25 to 26 seated | **Pass** |
| Seat-view images | 250 KB or less per file | 3 to 42 KB | **Pass** |
| Longest main-thread task while the 3D room loads | — | 3.0 to 3.6 s on a software GPU | Not representative: real GPUs compile shaders in parallel |
| Frame rate | 60 fps on iPhone 13, at least 45 on Pixel 6a | — | **Not run**: needs the devices |

Software GPUs no longer get the 3D room at all. Where a browser would render WebGL in software, the guest keeps the 2D plan; the test is `on a software GPU the guest keeps the 2D plan: the 3D room never starts`.

## Screens

The room, a chosen slot, a table's card and the list, at 390 x 844 and 1440 x 900, in light and dark. Captured in the 3D room by `pnpm screens` into `docs/gate/screens/` (the last capture's images are added there).

## Open visual notes

Found in the screenshot passes and left for the design review. None of them makes the room or the booking flow wrong.

- In close framing, a 3D table's label sits over the far edge of its own table.
- On a portrait phone, the 3D overview leaves an empty band above the room, because the plan's width sets the zoom.
- In the 3D room, planters read as plain plinths, and the kitchen block is a featureless slab.
- At dusk (dark mode), glassware is a flat grey.
- On a phone, before a table is chosen, the hint card covers the lower booths in the 3D overview.
- The seat views are true to the room, but a little washed out next to what a retouched photo would be. Real photos replace them with no code change (D-3).

## What was fixed because the gate checks found it

The tests and reviews behind this gate found real defects. Each was fixed and now has a test.

- **Double booking under contention.** Concurrent inserts under the exclusion constraint could deadlock (Postgres 40P01), and the deadlock surfaced as a server error instead of "taken". Holds now take a per-table advisory lock, and a deadlock counts as a lost race. Proof: `150 simultaneous holds across 5 tables`.
- **No-show before the booking.** A host could mark a guest a no-show days early, and a no-show keeps the guest's fee. Arrival now counts only on the night: seating on the booking's day, a no-show after its time. Proof: `arrival is marked on the night`.
- **Refunds through "another table".** A Host could seat a booking from days ago at another table, which triggers the automatic full refund. Now refused after the booking's day.
- **Kill-switch lag.** Pages and API routes are bundled separately, so they kept separate copies of the flag cache: the widget could hide while the APIs still answered. Now there is one cache per process, and the test requires both within 60 s.
- **The embed button never appeared.** The demo venue site was a React page; the async embed script ran from `<head>` before its target existed, and hydration would have removed the button. The page is now plain HTML, as a venue's site is, and `embed.js` places its button once the page is parsed. Proof: `G-12: one script tag adds the button …`.
- **Accessibility.** Fixed:
  - 3D labels, the Tonight date button and the Tables attribute buttons had names that did not contain their visible text (WCAG 2.5.3).
  - Several sentences were set at 14 to 15 px against the PRD's 16 px body text; the browser check now runs on every guest step and every portal screen.
  - The view toggle's touch target was 36 px.
- **Security review** (independent, no critical or high findings). Fixed:
  - the dev inbox showed operators guest manage links
  - every client shared one rate-limit bucket under the default proxy setting
  - a forgeable `X-Forwarded-For` hop was trusted
  - Turnstile test keys were accepted in production
  - manage tokens could appear in log paths

  Details in [`SECURITY.md`](SECURITY.md).
- **One frame from the wrong place.** When the camera cut to the seat, the lens changed at once but the position only reached the camera on the next update, so one frame showed the seat's wide lens from high above the room. The reduced-motion test now fails on any in-between frame, and the camera writes position and lens together.
- **3D on machines without a GPU.** A software-rendered 3D room held the page for seconds per frame. Those browsers now keep the 2D plan.
- **Test isolation.** A fee left by one test file changed another file's prices on one weekday, which turned CI red on Fridays. Reproduced with a fixed shuffle seed and fixed; the suite now passes in shuffled file orders.

## What surprised us

- **The database is the best concurrency test.** The exclusion constraint never let a double booking through. What surfaced instead was a deadlock between two losing writers, which only showed under 150 simultaneous holds.
- **Money rules hide in operator buttons.** "No-show" and "Seated at another table" move money as surely as "Refund", so they needed the same guard as the Owner-only actions.
- **Framework module boundaries matter for caches.** Next.js bundles route handlers and pages apart, so module-level state isn't shared between them.
- **A software GPU is no stand-in for a phone.** In this container, compiling the 3D room's shaders blocks the page for seconds, and frames can be seconds apart under load. Real phones compile in parallel on the GPU. Every 3D check here therefore asserts outcomes (position, framing, a cut, accessibility), not frame rates, and on-device frame rate stays a gate item.

## Not covered here, and what it needs

| Item | Why not here | What it needs |
| --- | --- | --- |
| Real phones and Safari: the device matrix, the demo on a real phone three times, 60 fps on iPhone 13 and 45 on Pixel 6a, Apple Pay inside a Safari iframe | No devices or Safari in this container (Chromium only, software GPU) | A deployment, then the device matrix by hand. Record frame rates with Safari and Chrome remote profiling, and the demo with screen recording. |
| Stripe test mode end to end, including Apple Pay domain registration | No Stripe keys | `STRIPE_*` test keys, `pnpm stripe:setup`, the money check rerun with `pnpm reconcile` |
| Email delivery through Postmark | No token | `POSTMARK_SERVER_TOKEN` and a sending domain with SPF, DKIM and DMARC |
| Turnstile with real keys | No keys; tests use Cloudflare's documented test keys | Turnstile site and secret keys |
| Usability with 5 first-time people | Needs people | Five sessions on a phone, timed against the 10 s and 90 s goals |
| Outside design review | Needs the designer | The demo recording and the screenshot sets |
| A VoiceOver run | Needs an Apple device | The full flow with VoiceOver on, in 3D and in the list |
| Deployment (Vercel and Neon) | No credentials | The README's deployment steps |
