import { expect, type Frame, type Page } from "@playwright/test";

/** A page, or the widget inside the embed's iframe. */
export type Surface = Page | Frame;
import pg from "pg";

/** Direct database access for assertions and fixtures (the e2e server's own database). */
export const DB_URL =
  process.env.E2E_DATABASE_URL ?? `postgres://pyt:pyt_local_only@127.0.0.1:54329/${process.env.E2E_DB ?? "pyt_e2e"}`;

export async function query<T extends pg.QueryResultRow>(sql: string, params: unknown[] = []): Promise<T[]> {
  const client = new pg.Client({ connectionString: DB_URL });
  await client.connect();
  try {
    return (await client.query<T>(sql, params)).rows;
  } finally {
    await client.end();
  }
}

/** Today's date in a time zone, as YYYY-MM-DD. */
export function todayIn(tz: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

export function addDays(date: string, n: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** The first Friday strictly after today in the venue's time zone (the demo script's "Friday"). */
export function nextFriday(tz = "America/Los_Angeles"): string {
  let d = addDays(todayIn(tz), 1);
  while (new Date(`${d}T12:00:00Z`).getUTCDay() !== 5) d = addDays(d, 1);
  return d;
}

function isoWeekdayOf(date: string): number {
  const x = new Date(`${date}T12:00:00Z`).getUTCDay();
  return x === 0 ? 7 : x;
}

/** A date at least `minDaysAhead` ahead whose weekday is `isoWeekday` (1 = Monday). */
export function nextWeekday(isoWeekday: number, minDaysAhead = 1, tz = "America/Los_Angeles"): string {
  let d = addDays(todayIn(tz), minDaysAhead);
  while (isoWeekdayOf(d) !== isoWeekday) d = addDays(d, 1);
  return d;
}

/** Opens the slot picker and applies date, time and party. */
export async function pickSlot(page: Surface, date: string, time: string, party = 2) {
  const trigger = page.getByRole("button", { name: /Choose a (time|date)/ }).first();
  await trigger.click();
  const sheet = page.getByRole("dialog").last();
  const partyOutput = sheet.locator("output").first();
  for (let i = 0; i < 6; i++) {
    const current = Number((await partyOutput.textContent())?.match(/\d+/)?.[0] ?? party);
    if (current === party) break;
    await sheet.getByRole("button", { name: current < party ? /^More: Party size/ : /^Fewer: Party size/ }).click();
  }
  await sheet.locator(`[data-date="${date}"]`).click();
  const label = new RegExp(`^${time.replace(":", "\\:")}, \\d+ tables free`);
  await sheet.getByRole("button", { name: label }).click();
  await sheet.getByRole("button", { name: /^Show tables for/ }).click();
  await expect(sheet).toBeHidden();
}

/** Taps a table in whichever room view is showing (2D plan, 3D labels or the list). */
export async function tapTable(page: Surface, label: string) {
  const target = page.getByRole("button", { name: new RegExp(`^${label}\\s?,`) }).first();
  await target.click();
  await expect(page.getByRole("heading", { name: label, exact: true }).first()).toBeVisible();
}

export function formatTimeLabel(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number) as [number, number];
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, "0")} ${h >= 12 ? "pm" : "am"}`;
}

/**
 * PRD interface rule: body text is 16 px or larger. Every visible run of five or more
 * words counts as body text; shorter runs (counts, prices, "4 seats") and lines marked
 * `data-meta` may be smaller.
 */
export async function expectBodyText16(page: Page, label: string) {
  const small = await page.evaluate(() => {
    const found: string[] = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const text = (n.textContent ?? "").replace(/\s+/g, " ").trim();
      const el = n.parentElement;
      if (!el || text.split(" ").length < 5) continue;
      // data-meta marks metadata lines (a table's attributes, counts): not body text.
      // Controls (buttons) have their own sizes; the rule is for text people read.
      if (el.closest("[aria-hidden='true'], [data-meta], button, .sr-only, script, style, noscript, pre")) continue;
      const r = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      if (r.width === 0 || r.height === 0 || style.visibility === "hidden" || Number(style.opacity) === 0) continue;
      const px = Number.parseFloat(style.fontSize);
      if (px < 15.5) found.push(`${px}px: ${text.slice(0, 60)}`);
    }
    return found;
  });
  expect(small, `${label}: ${small.join(" | ")}`).toEqual([]);
}

/** Signs an operator in through the real magic link, read from the dev mail store. */
export async function signIn(page: Page, email: string) {
  await page.goto("/portal/sign-in");
  await page.getByLabel("Email").fill(email);
  const requested = new Date();
  await page.getByRole("button", { name: "Email me a sign-in link" }).click();
  await expect(page.getByText(/Check your email/i)).toBeVisible();
  // The email is sent after the answer, so wait for it to reach the dev mail store.
  let link: string | undefined;
  await expect
    .poll(async () => {
      const [mail] = await query<{ text: string }>(
        `select text from email_message where "to" = $1 and created_at >= $2 order by created_at desc limit 1`,
        [email, requested],
      );
      link = mail?.text.match(/https?:\/\/\S+\/portal\/auth\?token=[A-Za-z0-9_-]{43}/)?.[0];
      return Boolean(link);
    })
    .toBe(true);
  if (!link) throw new Error("no sign-in link in the dev mail store");
  await page.goto(new URL(link).pathname + new URL(link).search);
  await page.getByRole("button", { name: /^Sign in to Halcyon/ }).click();
  await expect(page).toHaveURL(/\/portal\/tonight/);
}
