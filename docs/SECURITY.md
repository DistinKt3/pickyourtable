# Security

How Pick-Your-Table protects guests, venues and money, mapped to OWASP ASVS 4.0 Level 2. Each control names the code that enforces it and the test that proves it. The last section lists what is not covered and why.

**Scope:** the guest widget and its APIs, the operator portal, payments (real Stripe in test mode and the local simulator), email, scheduled jobs, and the build and dependency chain. There is no deployment yet, so hosting controls (TLS termination, WAF, backups) are out of scope.

**What we protect:**
- guests' names, emails, mobiles and notes
- the venue's booking data and prices
- the money path: a charge must equal the server's price, refunds must match policy, and nobody pays twice
- the operator portal itself

**Who we defend against:**
- a guest tampering with prices or holds
- bots squatting premium tables
- a cross-site attacker riding an operator's session
- an operator of one venue reaching another venue's data
- a Host moving money
- a stolen or forwarded link
- a compromised dependency release

## How it was checked (2026-10-23)

| Check | Result |
| --- | --- |
| Independent code review of authentication, authorization, venue scoping, tokens, payments, webhooks, escaping and configuration | No critical or high findings. Two medium and five low, all fixed or recorded below. |
| `pnpm audit` (every severity, production and dev dependencies) | 0 known vulnerabilities |
| Semgrep: `p/typescript`, `p/react`, `p/nextjs`, `p/secrets`, `p/owasp-top-ten` (145 rules, 312 files, rerun after the 3D room merged) | 0 findings |
| gitleaks over the full git history | No leaks. Named test fixtures are allowlisted in `.gitleaks.toml`. |
| Vitest security, red-team and role tests | 356 tests pass across 31 files, including `tests/integration/security/security.test.ts` and `tests/integration/portal/{roles,csrf,auth}.test.ts` |
| axe (WCAG 2.2 AA) on every guest step and every portal screen | 0 violations |

## Controls by ASVS chapter

### V1 Architecture

- **Prices are computed on the server only.** The price comes from the venue's rules when the hold is made and is stored on the row. Checkout takes no amount, and a PaymentIntent is reused only when its amount matches. Proof: `price-like fields from the client are ignored; the charge is the server price (S-1)`.
- **No overlapping bookings.** The database enforces this with an exclusion constraint on `(table_id, during)` for held, confirmed and seated rows (`db/migrations/0001_no_overlap.sql`). A per-table advisory lock gives concurrent writers one order. Proof: `the database itself refuses an overlapping booking (S-2)`, `20 rounds of 10 concurrent holds`, `150 simultaneous holds across 5 tables`.
- **One validated entry point.** Every HTTP route except `/api/health` goes through `api()` (`lib/http/api.ts`). It applies, in order: the kill switch, a same-origin check, the JSON content type, a 16 KB body cap, zod validation, an error envelope and `no-store`. There are no server actions.

### V2 Authentication (operators)

- **Magic links.**
  - Tokens are 256-bit, stored as SHA-256 hashes, and valid for 15 minutes.
  - Each link works once, through an atomic `UPDATE … WHERE used_at IS NULL`.
  - A link is redeemed only by POST; opening it (GET) only inspects it, because email scanners prefetch links.
  - The URL is built from `APP_URL`, never the Host header.
- **No account enumeration.** A request for a link answers `{ ok: true }` for every address, and the lookup and the email happen after the response. Requests are limited per IP and per email, the same way for known and unknown addresses.
- **Disabled operators are refused at once.**
- Proof: `tests/integration/portal/auth.test.ts` (works once, expiry, GET never redeems, enumeration, limits, cross-site redeem refused).

### V3 Sessions

- **The cookie** is `__Host-pyt_session`, HttpOnly, Secure, SameSite=Lax, with a 12-hour session.
- **No fixation:** each sign-in creates a new random token, and only its hash is stored.
- **Sign-out** deletes the session row. Role changes and disabling take effect on the next request.
- **Guests have no cookies at all.** A random device id in local storage is sent as a header, so the widget works inside third-party iframes.
- Proof: `uses a __Host- HttpOnly, Secure, SameSite=Lax session cookie`, `sign-out revokes the session and clears the cookie`.

### V4 Access control

- **Roles.**
  - Owner only: tables, pricing, turn times, blackouts, venue review, go-live, and cancel with refund.
  - Host: Tonight, Bookings, history, seat, no-show, undo, resend.
  - Every portal route checks the role (`portalReader` or `portalWriter` in `lib/portal/guard.ts`), and every portal page checks it again.
- **Venue scoping.** The venue always comes from the session, never from the request.
  - Bookings are loaded by id plus venue, and each state change re-checks `venue_id` in its UPDATE.
  - Blackouts and price rules are matched by id plus venue; tables and approvals by venue plus code.
  - Proof: `tests/integration/portal/roles.test.ts` (another venue's table, fee, blackout, review, history and booking).
- **Money movement.**
  - Venue cancellations with refunds are Owner-only.
  - The PRD's one automatic refund, when a guest is seated at another table, can be triggered by a Host only on the booking's own day.
  - A no-show keeps the fee, so it can be marked only after the booking time.
  - Proof: `arrival is marked on the night: seating on the booking's day, a no-show only after its time`.
- **Guest links.**
  - Hold tokens and manage tokens are HS256 JWTs with the algorithm pinned, issuer and audience checked, and a separate key derived per purpose.
  - A hold token's subject must equal the hold in the path.
  - A manage token also carries a per-booking nonce, compared in constant time, and expires after the visit.
  - Proof: `booking A's link can never read or cancel booking B (red team)`, `refuses tampered, foreign, expired and revoked tokens`, `only the hold's own token can read or release it`.

### V5 Validation, sanitization and encoding

- **Input:** every query, parameter and body is validated with zod (`lib/api/contracts.ts`). Venue ids are checked against a pattern before any file path is built.
- **Email:** every interpolated value in an email is HTML-escaped (`esc()` in `lib/email/templates`). The From name is stripped of quotes, CR/LF and angle brackets, so a header can't be injected through it. Proof: `escapes every interpolated value`, `shows the venue's name as the sender, never ours`.
- **No `dangerouslySetInnerHTML`.** The dev inbox renders stored email HTML in an `<iframe sandbox="">` through `srcDoc`, so no scripts run.

### V7 Errors and logging

- **One JSON line per event, with ids, amounts and outcome:** every hold, payment, webhook and refund. Proof: `a hold, its payment, the webhooks and a refund each write one line with ids, amounts and outcome` (S-6).
- **Redaction:**
  - Emails are masked in every string field.
  - Secret-like keys (token, secret, card, cookie, authorization) are redacted.
  - Manage tokens are cut out of logged request paths.
  - No card data reaches the server; the simulator never takes card numbers.
- **Errors:** internal errors return a generic message and a request id, never a stack trace. Proof: `hides internal errors`.

### V8 Data protection

- **Retention:** guest personal data is deleted 24 months after the visit, and the amounts are kept for the books. Proof: `deletes guest data 24 months after the visit and keeps the amounts`.
- **Caching:** API responses are `no-store`. Manage pages send `Referrer-Policy: no-referrer`, so the token in their URL never leaks to another site.

### V9 Communications

- **HSTS** in production (two years, preload).
- **`upgrade-insecure-requests`** whenever `APP_URL` is https.
- **Webfonts are self-hosted:** `font-src 'self'`, with no requests to font CDNs.

### V10 Malicious code and supply chain

- **Exact versions:**
  - Every dependency is pinned exactly (`saveExact`).
  - Every release must be at least 3 days old (`minimumReleaseAge: 4320`).
  - Only `sharp` and `esbuild` may run install scripts (`allowBuilds`).
  - Stable releases only.
- **CI actions** are pinned to commit SHAs.
- **Scans:** `pnpm audit`, gitleaks and Semgrep run on demand (`pnpm audit`, `pnpm secrets`, `pnpm semgrep`). The CI workflow runs the audit and gitleaks on every push; Semgrep runs locally, because it needs the Python tool.

### V11 Business logic

- **Holds:**
  - A hold lasts 8 minutes.
  - Each device and each email may have at most 2 active holds, enforced under a device lock so concurrent requests can't pass the limit together.
  - Turnstile is checked before every hold.
  - Hold attempts per IP, and availability reads per IP, are rate-limited.
  - Proof: `a bot holding every premium table from one device is stopped after 2`, `concurrent holds from one device cannot pass the limit together`, `one IP rotating devices is rate limited`, `at most 2 active holds per email`, `scraping availability at a high rate gets 429 (red team)`.
- **Payment after an expired hold:** if the table was held again in the meantime, the payment is refunded at once and the guest is emailed. Proof: `is refunded in full at once, with an email, when the table was held again (webhook path)`.
- **Reconciliation:** 20 bookings with their cancellations, refunds and expired holds match the provider to the cent. Proof: `20 bookings, cancellations, refunds and expired holds match the provider exactly`.
- **Kill switch:** `pyt_widget_enabled` hides the widget and stops the guest APIs within 60 s, with one cache per process. Payment webhooks are never stopped. Proof: `tests/e2e/kill-switch.spec.ts`, `the kill switch stops guest routes … but never payment webhooks (S-5)`.

### V13 API and web services

- **CSRF:**
  - Every unsafe request must have an `Origin` equal to `APP_URL` or the request's own origin, or `Sec-Fetch-Site: same-origin`.
  - `Origin: null` is refused.
  - Native form posts (sign-in request, redeem, sign-out) are covered.
  - The only exception is the Stripe webhook, which verifies its signature and timestamp and is idempotent on the event id.
  - Proof: `tests/integration/portal/csrf.test.ts`, `refuses cross-origin mutations`, `rejects a bad, missing or stale signature`, `a replayed event confirms once and sends one email`.
- **Cron:** routes require `Authorization: Bearer CRON_SECRET`, compared as SHA-256 digests with `timingSafeEqual`, and fail closed when the secret is unset.
- **Simulated payments:** the simulator's confirm endpoint does not exist in stripe mode. Its webhooks are signed with Stripe's scheme, using a key derived from `APP_SECRET`. Proof: `the simulator endpoint does not exist in stripe mode`.

### V14 Configuration

- **CSP:**
  - Each request gets a fresh nonce, with `strict-dynamic` (`proxy.ts`).
  - `object-src 'none'`, `base-uri 'none'` and `form-action 'self'`.
  - `frame-ancestors 'none'` everywhere except the guest widget, which allows `'self'` plus the validated `EMBED_ALLOWED_ORIGINS`.
  - `X-Frame-Options: DENY` is also set in `next.config.ts` for `/portal`, `/dev` and `/api`.
- **Other headers:** `nosniff`, a restrictive `Permissions-Policy`, COOP `same-origin-allow-popups`, and no `x-powered-by`.
- **The environment is validated at startup (`lib/env.ts`):**
  - Live Stripe keys are refused.
  - Stripe and Postmark modes require their keys.
  - `APP_SECRET` must be at least 32 characters.
  - In production it also refuses:
    - `TRUST_PROXY=none`, which would put every client in one rate-limit bucket; it defaults to `vercel` on Vercel
    - Turnstile's always-pass test keys
    - offline Turnstile
    - `RATE_LIMIT_SCALE` above 1

    A production build for tests or a private demo may set `PYT_TEST_DEPLOYMENT=1` to allow the last three, but never `TRUST_PROXY=none`. Proof: `refuses unsafe defaults in production unless it is a test deployment`.
- **Client IP:** with `TRUST_PROXY=xff` it is the last `X-Forwarded-For` hop, the one your proxy appended, never the forgeable first entry. Proof: `trusts only the configured client IP header, and only its last hop`.

## Findings from the review and what was done

| # | Severity | Finding | Outcome |
| --- | --- | --- | --- |
| M1 | Medium | With `EMAIL_MODE=dev` outside development, the dev inbox showed every operator their venue's guest mail. That mail includes manage links, so a Host could cancel and refund as the guest, outside the operator audit trail. | Fixed. Outside development an operator sees only mail addressed to them. |
| M2 | Medium | The default `TRUST_PROXY=none` turns every IP limit into one global bucket, so one client could block every sign-in or hold. | Fixed. Production refuses `none`, and the default is `vercel` on Vercel. |
| L1 | Low | `TRUST_PROXY=xff` used the first, client-controlled `X-Forwarded-For` entry. | Fixed. It uses the last hop. |
| L2 | Low | In production, Turnstile's always-pass test keys were accepted by default. | Fixed. Production refuses them unless `PYT_TEST_DEPLOYMENT=1`. |
| L3 | Low | A Host could trigger the seat-elsewhere refund on a booking from days ago. | Fixed. Seating is allowed on the booking's day only. |
| L4 | Low | Manage tokens could appear in the paths of error log lines. | Fixed. `logPath()` cuts them out. |
| L5 | Low (unconfirmed) | Framing protection depended on `proxy.ts` alone, whose matcher skips prefetches. | Fixed as hardening: `X-Frame-Options: DENY` in `next.config.ts`. |

Found during this pass outside the review:
- Seated and No-show were accepted days ahead of a booking, and an early No-show keeps the guest's fee. Fixed: the server refuses with `too_early`.
- Page and API flag caches could disagree for up to 15 s. Fixed: one cache per process.

## Residual risks and what stays out of scope

- **The device limit is advisory.** The device id is chosen by the client, so a bot can rotate it. The real limits are Turnstile and the per-IP and per-email limits. A determined attacker with many IPs and solved challenges can still hold tables, but each hold expires after 8 minutes and costs a challenge.
- **Real Stripe, Postmark and Turnstile have not run here,** because this environment has no keys. The Stripe adapter is the same code path as the simulator, which signs its webhooks with Stripe's scheme, but its first run against Stripe test mode should be watched (`pnpm stripe:setup`, then the README's test-mode steps).
- **Hosting is not covered:** no deployment, so TLS, DDoS protection, database backups and access to production logs are the host's settings and are not reviewed here. Use Vercel and Neon with least-privilege database roles.
- **There is no dynamic scan (DAST) or external penetration test.** The red-team checks are integration tests written against this code.
- **Email authentication** (SPF, DKIM and DMARC for the sending domain) is set up at Postmark when a domain exists.
- **`PAYMENTS_MODE=sim` in production** lets anyone "pay" with a simulated card. That is intended for a public demo, and it can never move real money, because live keys are refused. A real deployment sets Stripe test or live keys deliberately, and live keys need a code change to `lib/env.ts`.
