import { expect, type Page, test } from "@playwright/test";
import { addDays, formatTimeLabel, nextWeekday, pickSlot, query, signIn, tapTable, todayIn } from "./helpers";

/**
 * Timed acceptance checks from the PRD that need a browser: G-2 (availability within
 * 500 ms), O-4 (a blackout reaches a guest's screen within 10 s), O-1 (Seated and
 * No-show update in under 2 s) and G-12 (the embed button opens the widget full screen
 * and checkout works inside it). Each test uses its own Sunday or today, so no two
 * share a table.
 */

const TZ = "America/Los_Angeles";
const OWNER = "owner@halcyon.example";
const sunday = (weeks: number) => addDays(nextWeekday(7, 3, TZ), 7 * weeks);

/** A paid booking straight into the database, with a guest, for fixtures the flow cannot make (a time that has passed). */
async function paidBooking(code: string, startsAtSql: string, name: string): Promise<string> {
  const [g] = await query<{ id: string }>(
    `insert into guest (name, email, mobile) values ($1, $2, '+14155550100') returning id`,
    [name, `${name.toLowerCase().replace(/\W+/g, ".")}@example.com`],
  );
  const [r] = await query<{ id: string }>(
    `insert into reservation (venue_id, table_id, party_size, starts_at, ends_at, daypart, day_type, status, guest_id,
       price_cents, application_fee_cents, device_hash, ip_hash, manage_nonce, confirmed_at, payment_intent_id, card_brand, card_last4)
     select 'halcyon', t.id, 2, ${startsAtSql}, ${startsAtSql} + interval '90 minutes', 'dinner', 'weeknight', 'confirmed', $2,
       2500, 750, 'e2e-fixture', 'e2e-fixture', md5(random()::text), now(), 'pi_e2e_' || md5(random()::text), 'visa', '4242'
     from venue_table t where t.venue_id = 'halcyon' and t.code = $1 returning reservation.id`,
    [code, g!.id],
  );
  return r!.id;
}

/** The list view's row for a table: its name, tier, state and price, whatever the renderer. */
function listRow(page: Page, label: string) {
  return page.getByRole("button", { name: new RegExp(`^${label}\\s?,`) }).first();
}

test("G-2: a change of time shows every table's state within 500 ms", async ({ page }, info) => {
  test.skip(info.project.name !== "phone");
  const date = sunday(0);
  await query(
    `insert into reservation (venue_id, table_id, party_size, starts_at, ends_at, daypart, day_type, status,
       price_cents, application_fee_cents, device_hash, ip_hash, manage_nonce, confirmed_at)
     select 'halcyon', t.id, 2, ($1 || ' 19:00')::timestamp at time zone '${TZ}', ($1 || ' 20:30')::timestamp at time zone '${TZ}',
       'dinner', 'weeknight', 'confirmed', 2500, 750, 'e2e-elsewhere', 'e2e-elsewhere', md5(random()::text), now()
     from venue_table t where t.venue_id = 'halcyon' and t.code = 'W1'`,
    [date],
  );
  await page.goto("/v/halcyon");
  await page.getByRole("radio", { name: "List" }).check({ force: true });
  // Time from the guest's tap on "Show tables" to Window 1 reading "Taken", measured in the page.
  await page.evaluate(() => {
    const w = window as unknown as { __applyAt?: number; __shownAt?: number };
    document.addEventListener(
      "click",
      (e) => {
        if ((e.target as Element).closest("button")?.textContent?.startsWith("Show tables")) w.__applyAt = performance.now();
      },
      true,
    );
    new MutationObserver(() => {
      if (w.__shownAt || !w.__applyAt) return;
      const row = [...document.querySelectorAll("button")].find((b) => b.textContent?.startsWith("Window 1"));
      if (row?.textContent?.includes("Taken")) w.__shownAt = performance.now();
    }).observe(document.body, { subtree: true, childList: true, characterData: true });
  });
  await pickSlot(page, date, formatTimeLabel("19:00"), 2);
  await expect(listRow(page, "Window 1")).toContainText("Taken");
  const ms = await page.evaluate(() => {
    const w = window as unknown as { __applyAt?: number; __shownAt?: number };
    return (w.__shownAt ?? Number.NaN) - (w.__applyAt ?? Number.NaN);
  });
  info.annotations.push({ type: "availability shown", description: `${Math.round(ms)} ms` });
  expect(ms).toBeLessThan(500);
});

test("O-4: a blackout the owner adds shows as taken to a guest within 10 s", async ({ browser, page }, info) => {
  test.skip(info.project.name !== "desktop");
  const date = sunday(1);
  const guestContext = await browser.newContext();
  const guest = await guestContext.newPage();
  try {
    await guest.goto("/v/halcyon");
    await guest.getByRole("radio", { name: "List" }).check({ force: true });
    await pickSlot(guest, date, formatTimeLabel("19:30"), 2);
    await expect(listRow(guest, "Booth 3")).toContainText(/Available/);

    await signIn(page, OWNER);
    const res = await page.request.post("/api/portal/blackouts", {
      headers: { origin: new URL(page.url()).origin },
      data: { table: "B3", date, from: "18:00", to: "22:00", reason: "Private party" },
    });
    expect(res.status()).toBeLessThan(300);
    const added = Date.now();
    await expect(listRow(guest, "Booth 3")).toContainText("Taken", { timeout: 10_000 });
    info.annotations.push({ type: "blackout reached the guest", description: `${Date.now() - added} ms` });
  } finally {
    await guestContext.close();
  }
});

test("O-1: Seated and No-show update Tonight in under 2 s", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop");
  // Both bookings started a few minutes ago today, so the host can mark either.
  const now = new Date();
  const local = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false }).format(now);
  test.skip(local < "00:10", "too close to midnight in the venue for a booking that started today");
  const seatedName = `Avery Seated ${Date.now().toString(36)}`;
  const noShowName = `Blair Missing ${Date.now().toString(36)}`;
  await paidBooking("C1", "now() - interval '4 minutes'", seatedName);
  await paidBooking("C2", "now() - interval '4 minutes'", noShowName);

  await signIn(page, OWNER);
  await page.goto(`/portal/tonight?date=${todayIn(TZ)}`);
  for (const [name, button, done] of [
    [seatedName, /^Mark .* seated at /, /Seated/],
    [noShowName, /as a no-show$/, /No-show/],
  ] as const) {
    const row = page.getByRole("listitem").filter({ hasText: name });
    await expect(row).toBeVisible();
    const saved = page.waitForResponse((r) => /\/api\/portal\/reservations\/.+\/(seat|no-show)$/.test(r.url()));
    const started = Date.now();
    await row.getByRole("button", { name: button }).click();
    expect((await saved).status()).toBe(200);
    await expect(row).toContainText(done);
    const ms = Date.now() - started;
    info.annotations.push({ type: `${name.split(" ")[1]} saved and shown`, description: `${ms} ms` });
    expect(ms).toBeLessThan(2000);
  }
  const rows = await query<{ status: string }>(
    `select r.status from reservation r join guest g on g.id = r.guest_id where g.name in ($1, $2) order by g.name`,
    [seatedName, noShowName],
  );
  expect(rows.map((r) => r.status)).toEqual(["seated", "no_show"]);
});

test("G-12: one script tag adds the button; the widget opens full screen and checkout works", async ({ page }, info) => {
  test.skip(info.project.name !== "phone");
  const date = sunday(2);
  await page.goto("/demo/halcyon");
  await page.getByRole("button", { name: "Choose your table" }).click();
  const overlay = page.getByRole("dialog", { name: "Choose your table" });
  await expect(overlay).toBeVisible();
  const box = await overlay.boundingBox();
  const viewport = page.viewportSize()!;
  expect(box).toMatchObject({ x: 0, y: 0, width: viewport.width, height: viewport.height });

  const frame = page.frameLocator('iframe[title="Choose your table"]');
  await expect(frame.getByRole("heading", { name: "Halcyon" })).toBeVisible();
  const widget = page.frames().find((f) => f.url().includes("/v/halcyon"));
  if (!widget) throw new Error("the widget frame did not load");
  await pickSlot(widget, date, formatTimeLabel("18:30"), 2);
  await tapTable(widget, "Window 5");
  await frame.getByRole("button", { name: /^Reserve this table/ }).click();
  await frame.getByLabel("Name").fill("Casey Embed");
  await frame.getByLabel("Email").fill(`casey+${Date.now()}@example.com`);
  await frame.getByLabel("Mobile").fill("+1 415 555 0177");
  await frame.getByRole("button", { name: /^Continue to payment/ }).click();
  await frame.getByRole("radio", { name: /Apple Pay/ }).check();
  await frame.getByRole("button", { name: /^Pay \$/ }).click();
  await expect(frame.getByRole("heading", { name: /You.re at Window 5/ })).toBeVisible({ timeout: 30_000 });

  // Done, then the widget's own Close, returns to the venue's page (the close message is
  // accepted only from our origin).
  await frame.getByRole("button", { name: "Done", exact: true }).click();
  await frame.getByRole("button", { name: "Close", exact: true }).first().click();
  await expect(overlay).toBeHidden();
  await expect(page.getByRole("button", { name: "Choose your table" })).toBeVisible();
});
