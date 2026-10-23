import "./_env";
import { type ChildProcess, spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { type BrowserContext, chromium, type Page } from "@playwright/test";
import { and, desc, eq, gt, inArray } from "drizzle-orm";
import { closeDb, db } from "@/db/client";
import { blackout, emailMessage, magicLink, priceRule, venue, venueTable } from "@/db/schema";
import { issueMagicLink } from "@/lib/auth/session";
import { addDays, todayIn } from "@/lib/format";
import { blackoutInstants } from "@/lib/portal/blackouts";
import { fixtureBookings, fixtureTonight, seedFixtureReservations } from "@/lib/portal/dev-fixtures";
import { sha256 } from "@/lib/security/crypto";
import { localToUtc } from "@/lib/portal/time";

/**
 * Portal screenshots for design review.
 *
 *   pnpm exec tsx --conditions=react-server scripts/screens-portal.ts [--only=tonight,bookings] [--viewport=desktop] [--theme=dark]
 *
 * Uses the dev database and server from .env.local (APP_URL, default port 3103) and
 * starts `next dev` when nothing answers. Seeds a realistic Friday-night service, signs
 * in through the real magic-link flow (the link is read from the email_message table),
 * then captures every screen at iPad portrait (820 x 1180), iPad landscape
 * (1180 x 820) and desktop (1440 x 900), light and dark, into
 * tests/screens/__output__/portal/. While the booking service's Tonight and Bookings
 * operations still answer 501, those two reads are served from the same seeded rows.
 */

const BASE = (process.env.APP_URL ?? "http://localhost:3103").replace(/\/$/, "");
const OUT = "tests/screens/__output__/portal";
const VENUE = "halcyon";
const OWNER = "owner@halcyon.example";
const HOST = "host@halcyon.example";
const EXECUTABLE = process.env.PW_CHROMIUM ?? "/opt/pw-browsers/chromium";

const VIEWPORTS = [
  { name: "ipad-portrait", width: 820, height: 1180, scale: 2 },
  { name: "ipad-landscape", width: 1180, height: 820, scale: 2 },
  { name: "desktop", width: 1440, height: 900, scale: 1 },
] as const;
const PHONE = { name: "phone", width: 390, height: 844, scale: 3 } as const;
const THEMES = ["light", "dark"] as const;

const BLACKOUT_REASONS = ["Heater repair", "Private dinner for 12", "Staff training", "Booth reupholstery"];
const UNAPPROVED = ["C2", "T4", "S8"];

const args = Object.fromEntries(
  process.argv
    .slice(2)
    .filter((a) => a.startsWith("--"))
    .map((a) => {
      const [k, v] = a.slice(2).split("=");
      return [k!, v ?? "true"];
    }),
);
const only = args.only ? new Set(args.only.split(",")) : null;
const want = (name: string) => !only || only.has(name);

/* ------------------------------------------------------------ Server */

async function healthy(): Promise<boolean> {
  try {
    const res = await fetch(`${BASE}/api/health`, { signal: AbortSignal.timeout(3000) });
    return res.ok;
  } catch {
    return false;
  }
}

async function ensureServer(): Promise<ChildProcess | null> {
  if (await healthy()) return null;
  const port = new URL(BASE).port || "3103";
  console.log(`starting next dev on ${port}`);
  const child = spawn("pnpm", ["exec", "next", "dev", "-p", port], {
    stdio: "ignore",
    env: { ...process.env, RATE_LIMIT_SCALE: process.env.RATE_LIMIT_SCALE ?? "50" },
  });
  for (let i = 0; i < 120; i++) {
    if (await healthy()) return child;
    await new Promise((r) => setTimeout(r, 1000));
  }
  child.kill();
  throw new Error(`the dev server did not start on ${BASE}`);
}

/* ------------------------------------------------------------- Data */

async function seed(today: string, tz: string) {
  await seedFixtureReservations(VENUE, today);

  await db()
    .delete(blackout)
    .where(and(eq(blackout.venueId, VENUE), inArray(blackout.reason, BLACKOUT_REASONS)));
  const tables = await db()
    .select({ id: venueTable.id, code: venueTable.code })
    .from(venueTable)
    .where(eq(venueTable.venueId, VENUE));
  const id = (code: string) => tables.find((t) => t.code === code)!.id;
  const block = (table: string | null, date: string, from: string, to: string, reason: string) => ({
    venueId: VENUE,
    tableId: table ? id(table) : null,
    reason,
    ...blackoutInstants(date, from, to, tz),
  });
  await db()
    .insert(blackout)
    .values([
      block("T4", today, "17:00", "23:59", "Heater repair"),
      block("T3", addDays(today, 1), "17:00", "23:59", "Private dinner for 12"),
      block("B4", addDays(today, 2), "11:30", "14:30", "Booth reupholstery"),
      block(null, addDays(today, 6), "00:00", "23:59", "Staff training"),
    ]);

  // A special date in the fee screen.
  const year = Number(today.slice(0, 4));
  const nye = `${today > `${year}-12-31` ? year + 1 : year}-12-31`;
  await db()
    .delete(priceRule)
    .where(and(eq(priceRule.venueId, VENUE), eq(priceRule.dayType, "special"), eq(priceRule.specialDate, nye)));
  await db()
    .insert(priceRule)
    .values(
      [
        ["window", 7500],
        ["booth", 6000],
        ["counter", 4500],
        ["terrace", 6500],
      ].map(([tier, fee]) => ({
        venueId: VENUE,
        tier: tier as string,
        daypart: "dinner",
        dayType: "special" as const,
        specialDate: nye,
        feeCents: fee as number,
      })),
    );

  // Venue review mid-way: three tables waiting, the venue not live yet.
  await db().update(venueTable).set({ approvedAt: new Date() }).where(eq(venueTable.venueId, VENUE));
  await db()
    .update(venueTable)
    .set({ approvedAt: null, approvedBy: null })
    .where(and(eq(venueTable.venueId, VENUE), inArray(venueTable.code, UNAPPROVED)));
  await db().update(venue).set({ live: false, wentLiveAt: null }).where(eq(venue.id, VENUE));
}

async function restore() {
  await db().update(venueTable).set({ approvedAt: new Date() }).where(eq(venueTable.venueId, VENUE));
  await db().update(venue).set({ live: true, wentLiveAt: new Date() }).where(eq(venue.id, VENUE));
}

/** The sign-in link from the newest email to `to`, as the real flow sends it. */
async function linkFromInbox(to: string, since: Date): Promise<string> {
  for (let i = 0; i < 50; i++) {
    const [mail] = await db()
      .select({ text: emailMessage.text })
      .from(emailMessage)
      .where(and(eq(emailMessage.to, to), gt(emailMessage.createdAt, since)))
      .orderBy(desc(emailMessage.createdAt))
      .limit(1);
    const m = mail ? /(https?:\/\/\S+\/portal\/auth\?token=[A-Za-z0-9_-]{43})/.exec(mail.text) : null;
    if (m) return m[1]!;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`no sign-in email reached ${to}`);
}

/* ---------------------------------------------------------- Capture */

async function settle(page: Page, ms = 350) {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(ms);
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const server = await ensureServer();
  const config = await db().select({ tz: venue.timezone }).from(venue).where(eq(venue.id, VENUE));
  const tz = config[0]!.tz;
  const today = todayIn(tz);
  // 7:45 pm at the host stand.
  const NOW = localToUtc(today, "19:45", tz);
  await seed(today, tz);

  const browser = await chromium.launch({ executablePath: EXECUTABLE });
  let shots = 0;

  async function context(
    vp: { width: number; height: number; scale: number },
    theme: "light" | "dark",
    state?: string,
  ): Promise<BrowserContext> {
    const ctx = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      deviceScaleFactor: vp.scale,
      colorScheme: theme,
      reducedMotion: "reduce",
      storageState: state,
      locale: "en-US",
      timezoneId: tz,
    });
    await ctx.clock.setFixedTime(NOW);
    // Tonight and Bookings come from the booking service; while it answers 501, serve the seeded rows.
    await ctx.route(/\/api\/portal\/tonight(\?|$)/, async (route) => {
      const res = await route.fetch();
      if (res.status() !== 501) return route.fulfill({ response: res });
      const date = new URL(route.request().url()).searchParams.get("date") ?? today;
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(await fixtureTonight(VENUE, date, NOW)),
      });
    });
    await ctx.route(/\/api\/portal\/bookings(\?|$)/, async (route) => {
      const res = await route.fetch();
      if (res.status() !== 501) return route.fulfill({ response: res });
      const url = new URL(route.request().url());
      const status = (url.searchParams.get("status") ?? "upcoming") as "upcoming" | "past" | "cancelled" | "all";
      const body = await fixtureBookings(VENUE, { q: url.searchParams.get("q") ?? undefined, status }, NOW);
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
    });
    return ctx;
  }

  async function shot(page: Page, prefix: string, name: string) {
    await settle(page);
    await page.screenshot({ path: `${OUT}/${prefix}-${name}.png` });
    shots += 1;
  }

  // Sign in once per role through the real flow, and keep the session for every capture.
  const signInPage = await (await context(VIEWPORTS[1], "light")).newPage();
  await signInPage.goto(`${BASE}/portal/sign-in`);
  await signInPage.getByLabel("Email").fill(OWNER);
  const since = new Date(Date.now() - 2000);
  await signInPage.getByRole("button", { name: "Email me a sign-in link" }).click();
  await signInPage.getByText("Check your email").waitFor();
  await signInPage.goto(await linkFromInbox(OWNER, since));
  await signInPage.getByRole("button", { name: /^Sign in to / }).click();
  await signInPage.waitForURL("**/portal/tonight");
  const ownerState = await signInPage.context().storageState();
  await signInPage.context().close();

  async function signInAs(email: string) {
    const issued = await issueMagicLink(email);
    const ctx = await context(VIEWPORTS[1], "light");
    const page = await ctx.newPage();
    await page.goto(`${BASE}/portal/auth?token=${issued!.token}`);
    await page.getByRole("button", { name: /^Sign in to / }).click();
    await page.waitForURL("**/portal/tonight");
    const state = await ctx.storageState();
    await ctx.close();
    return state;
  }
  const hostState = await signInAs(HOST);

  const ownerFile = `${OUT}/.owner-state.json`;
  const hostFile = `${OUT}/.host-state.json`;
  const { writeFile } = await import("node:fs/promises");
  await writeFile(ownerFile, JSON.stringify(ownerState));
  await writeFile(hostFile, JSON.stringify(hostState));

  const viewports = VIEWPORTS.filter((v) => !args.viewport || args.viewport === v.name);
  const themes = THEMES.filter((t) => !args.theme || args.theme === t);

  for (const vp of viewports) {
    for (const theme of themes) {
      const prefix = `${vp.name}-${theme}`;
      console.log(prefix);

      const ctx = await context(vp, theme, ownerFile);
      const page = await ctx.newPage();

      if (want("tonight")) {
        await page.goto(`${BASE}/portal/tonight`);
        await page.locator("[data-row]").first().waitFor();
        await page.getByText("Tonight isn't updating").waitFor({ state: "detached" });
        await shot(page, prefix, "tonight");

        await page.getByRole("button", { name: "Seat Elena Marchetti at a different table" }).click();
        await page
          .getByRole("dialog")
          .getByRole("button", { name: /^Table 14/ })
          .click();
        await shot(page, prefix, "tonight-seat-elsewhere");
        await page.keyboard.press("Escape");

        await page.getByRole("button", { name: "Show Window 1 on the plan" }).first().click();
        await shot(page, prefix, "tonight-selected");
      }

      if (want("bookings")) {
        await page.goto(`${BASE}/portal/bookings`);
        await page
          .getByRole("button", { name: /Elena Marchetti/ })
          .first()
          .waitFor();
        await shot(page, prefix, "bookings");
        await page
          .getByRole("button", { name: /Elena Marchetti/ })
          .first()
          .click();
        await page.getByRole("dialog").getByText("History").waitFor();
        await shot(page, prefix, "booking-detail");
        await page.getByRole("button", { name: "Cancel with full refund" }).click();
        await page.getByLabel("Reason").fill("Kitchen closed early for a private event");
        await shot(page, prefix, "booking-cancel");
        await page.keyboard.press("Escape");
      }

      if (want("tables")) {
        await page.goto(`${BASE}/portal/tables`);
        await page.getByRole("heading", { name: "Tables and pricing" }).waitFor();
        await shot(page, prefix, "tables");
        await page.goto(`${BASE}/portal/tables?tab=fees`);
        await page.getByText("Fee changes apply to new holds only").waitFor();
        await shot(page, prefix, "fees");
        await page.getByLabel("Window, Dinner, weekend").fill("45");
        await page.getByLabel("Booth, Dinner, weekend").fill("32.50");
        await shot(page, prefix, "fees-edited");
        await page.goto(`${BASE}/portal/tables?tab=turns`);
        await page.getByRole("button", { name: "Save turn times" }).waitFor();
        await shot(page, prefix, "turn-times");
      }

      if (want("blackouts")) {
        await page.goto(`${BASE}/portal/blackouts`);
        await page.getByRole("heading", { name: "Block a table or the room" }).waitFor();
        await shot(page, prefix, "blackouts");
        await page.getByLabel("Table", { exact: true }).selectOption("W1");
        await page.getByLabel("From", { exact: true }).fill("19:00");
        await page.getByLabel("To", { exact: true }).fill("21:00");
        await page.getByLabel("Reason", { exact: true }).fill("Window cleaning");
        await page
          .getByText(/confirmed booking/)
          .first()
          .waitFor();
        await shot(page, prefix, "blackouts-warning");
      }

      if (want("review")) {
        await page.goto(`${BASE}/portal/review`);
        await page.getByText(/tables approved/).waitFor();
        await shot(page, prefix, "review");
      }
      await ctx.close();

      if (want("host")) {
        const hctx = await context(vp, theme, hostFile);
        const hpage = await hctx.newPage();
        await hpage.goto(`${BASE}/portal/tonight`);
        await hpage.locator("[data-row]").first().waitFor();
        await hpage.getByText("Tonight isn't updating").waitFor({ state: "detached" });
        await shot(hpage, prefix, "host-tonight");
        await hpage.goto(`${BASE}/portal/tables`);
        await shot(hpage, prefix, "host-owner-only");
        await hctx.close();
      }

      if (want("sign-in")) {
        const actx = await context(vp, theme);
        const apage = await actx.newPage();
        await apage.goto(`${BASE}/portal/sign-in`);
        await shot(apage, prefix, "sign-in");
        await apage.getByLabel("Email").fill(OWNER);
        await apage.getByRole("button", { name: "Email me a sign-in link" }).click();
        await apage.getByText("Check your email").waitFor();
        await shot(apage, prefix, "sign-in-sent");
        const issued = await issueMagicLink(OWNER);
        await apage.goto(`${BASE}/portal/auth?token=${issued!.token}`);
        await shot(apage, prefix, "auth");
        await db()
          .update(magicLink)
          .set({ expiresAt: new Date(Date.now() - 60_000) })
          .where(eq(magicLink.tokenHash, sha256(issued!.token)));
        await apage.goto(`${BASE}/portal/auth?token=${issued!.token}`);
        await shot(apage, prefix, "auth-expired");
        await actx.close();
      }
    }
  }

  if (want("phone") && !args.viewport) {
    const ctx = await context(PHONE, "light", ownerFile);
    const page = await ctx.newPage();
    await page.goto(`${BASE}/portal/tonight`);
    await page.locator("[data-row]").first().waitFor();
    await page.getByText("Tonight isn't updating").waitFor({ state: "detached" });
    await shot(page, "phone-light", "tonight");
    await page.goto(`${BASE}/portal/bookings`);
    await page
      .getByRole("button", { name: /Elena Marchetti/ })
      .first()
      .waitFor();
    await shot(page, "phone-light", "bookings");
    await page.goto(`${BASE}/portal/blackouts`);
    await shot(page, "phone-light", "blackouts");
    await ctx.close();
  }

  // A printed run sheet, as the browser's print preview renders it.
  if (want("print")) {
    const ctx = await context(VIEWPORTS[2], "light", ownerFile);
    const page = await ctx.newPage();
    await page.goto(`${BASE}/portal/tonight`);
    await page.locator("[data-row]").first().waitFor();
    await page.getByText("Tonight isn't updating").waitFor({ state: "detached" });
    await page.emulateMedia({ media: "print" });
    await settle(page);
    await page.screenshot({ path: `${OUT}/print-run-sheet.png`, fullPage: true });
    await page.pdf({ path: `${OUT}/print-run-sheet.pdf`, format: "Letter", printBackground: false });
    shots += 1;
    await ctx.close();
  }

  await browser.close();
  await restore();
  await closeDb();
  if (server) server.kill();
  console.log(JSON.stringify({ event: "screens.portal", shots, out: OUT }));
}

await main();
