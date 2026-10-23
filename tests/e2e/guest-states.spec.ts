import { expect, type Page, test } from "@playwright/test";
import { addDays, formatTimeLabel, nextWeekday, pickSlot, query, tapTable } from "./helpers";

/**
 * Every guest state in the PRD's table: no free table of the tier, taken between
 * viewing and holding, hold expired, payment declined, offline. (No WebGL is covered
 * by a11y.spec.ts.) Each test uses its own date so tests never share tables.
 */

const TZ = "America/Los_Angeles";

/** A paid booking made elsewhere, straight into the database. */
async function bookElsewhere(code: string, date: string, time: string, minutes = 90) {
  await query(
    `insert into reservation (venue_id, table_id, party_size, starts_at, ends_at, daypart, day_type, status,
       price_cents, application_fee_cents, device_hash, ip_hash, manage_nonce, confirmed_at)
     select 'halcyon', t.id, 2, ($2 || ' ' || $3)::timestamp at time zone '${TZ}',
       ($2 || ' ' || $3)::timestamp at time zone '${TZ}' + make_interval(mins => $4::int),
       'dinner', 'weeknight', 'confirmed', 2500, 750, 'e2e-elsewhere', 'e2e-elsewhere', md5(random()::text), now()
     from venue_table t where t.venue_id = 'halcyon' and t.code = $1`,
    [code, date, time, minutes],
  );
}

async function fillDetails(page: Page, tag: string) {
  await page.getByLabel("Name").fill("Robin Ellis");
  await page.getByLabel("Email").fill(`robin+${tag}-${Date.now()}@example.com`);
  await page.getByLabel("Mobile").fill("+1 415 555 0123");
  await page.getByRole("button", { name: /^Continue to payment/ }).click();
  await expect(page.getByRole("button", { name: /^Pay \$/ })).toBeVisible();
}

test.describe.configure({ mode: "serial" });

test("no free table of the tier: the 3 nearest times with one free", async ({ page }, info) => {
  test.skip(info.project.name !== "phone");
  const date = nextWeekday(2, 9, TZ); // a Tuesday, more than a week out
  for (const code of ["W1", "W2", "W3", "W4", "W5", "W6"]) await bookElsewhere(code, date, "19:00", 90);
  await page.goto("/v/halcyon");
  await pickSlot(page, date, formatTimeLabel("19:00"), 2);
  await tapTable(page, "Window 1");
  await expect(page.getByText(/No window table is free at 7:00 pm\. Nearest times with one free:/)).toBeVisible();
  const chips = page.locator("section[aria-label$='table details'] button").filter({ hasText: /^\d{1,2}:\d{2} (am|pm)$/ });
  await expect(chips).toHaveCount(3);
  await chips.first().click();
  await expect(page.getByRole("button", { name: /^Reserve this table – \$/ })).toBeVisible();
});

test("taken between viewing and holding: told plainly and offered the most similar table", async ({ page }, info) => {
  test.skip(info.project.name !== "phone");
  const date = nextWeekday(3, 9, TZ); // a Wednesday
  await page.goto("/v/halcyon");
  await pickSlot(page, date, formatTimeLabel("19:30"), 2);
  await tapTable(page, "Window 2");
  await expect(page.getByRole("button", { name: /^Reserve this table/ })).toBeVisible();
  await bookElsewhere("W2", date, "19:30");
  await page.getByRole("button", { name: /^Reserve this table/ }).click();
  await expect(page.getByText("Someone just took this table.")).toBeVisible();
  await expect(page.getByText(/is the most similar table that's free/)).toBeVisible();
  await expect(page.locator("[data-card-title]:visible").first()).not.toHaveText("Window 2");
});

test("payment declined: the reason in plain words, the hold kept, another method works", async ({ page }, info) => {
  test.skip(info.project.name !== "phone");
  const date = nextWeekday(4, 9, TZ); // a Thursday
  await page.goto("/v/halcyon");
  await pickSlot(page, date, formatTimeLabel("18:00"), 2);
  await tapTable(page, "Window 3");
  await page.getByRole("button", { name: /^Reserve this table/ }).click();
  await fillDetails(page, "declined");
  await page.getByRole("radio", { name: /Visa ending 0002/ }).check();
  await page.getByRole("button", { name: /^Pay \$/ }).click();
  await expect(page.getByText("Payment didn't go through")).toBeVisible();
  await expect(page.getByText(/Your table is still held/)).toBeVisible();
  await expect(page.getByRole("timer")).toBeVisible();
  await page.getByRole("radio", { name: /Visa ending 4242/ }).check();
  await page.getByRole("button", { name: /^Pay \$/ }).click();
  await expect(page.getByRole("heading", { name: /You.re at Window 3/ })).toBeVisible({ timeout: 30_000 });
});

test("offline: the hold is safe and the countdown keeps going", async ({ page, context }, info) => {
  test.skip(info.project.name !== "phone");
  const date = addDays(nextWeekday(4, 9, TZ), 7);
  await page.goto("/v/halcyon");
  await pickSlot(page, date, formatTimeLabel("18:30"), 2);
  await tapTable(page, "Window 4");
  await page.getByRole("button", { name: /^Reserve this table/ }).click();
  await expect(page.getByRole("timer")).toBeVisible();
  await context.setOffline(true);
  await expect(page.getByText("You're offline")).toBeVisible();
  await expect(page.getByText(/Your hold is safe for \d+:\d{2}/)).toBeVisible();
  await context.setOffline(false);
  await expect(page.getByText("You're offline")).toBeHidden();
});

test("hold expired: the table is released and one tap holds it again", async ({ page }, info) => {
  test.skip(info.project.name !== "phone");
  const date = addDays(nextWeekday(3, 9, TZ), 7);
  await page.clock.install();
  await page.goto("/v/halcyon");
  await pickSlot(page, date, formatTimeLabel("20:15"), 2);
  await tapTable(page, "Window 6");
  await page.getByRole("button", { name: /^Reserve this table/ }).click();
  await expect(page.getByRole("timer")).toBeVisible();
  // Eight minutes pass: the server's hold lapses and the browser's countdown runs out.
  await query(
    `update reservation set hold_expires_at = now() - interval '1 second' where status = 'held' and table_id = (select id from venue_table where venue_id = 'halcyon' and code = 'W6')`,
  );
  await page.clock.fastForward("08:05");
  await expect(page.getByRole("heading", { name: "Your hold ended" })).toBeVisible();
  await page.getByRole("button", { name: "Hold Window 6 again" }).click();
  await expect(page.getByRole("heading", { name: "Your details" })).toBeVisible();
  await expect(page.getByRole("timer")).toBeVisible();
});
