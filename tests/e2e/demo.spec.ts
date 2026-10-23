import { expect, test } from "@playwright/test";
import { addDays, formatTimeLabel, nextFriday, pickSlot, query, tapTable } from "./helpers";

/**
 * The PRD demo script (M2 gate): open Halcyon on a phone, pick Friday 8:00 pm for 2,
 * tap Window 1, sit here, swipe to Booth 2 to compare, reserve with Apple Pay in test
 * mode, see the confirmation with the seat view. Must finish in under 90 seconds.
 */
test("demo script runs end to end in under 90 seconds", async ({ page }, info) => {
  const started = Date.now();
  // Each project and repeat books its own Friday, so runs never compete for Window 1.
  const lane = ["phone", "desktop", "phone-3d", "desktop-3d"].indexOf(info.project.name);
  const friday = addDays(nextFriday(), 7 * (4 * info.repeatEachIndex + lane));
  await page.goto("/v/halcyon");
  await expect(page.getByRole("heading", { name: "Halcyon" })).toBeVisible();

  await pickSlot(page, friday, formatTimeLabel("20:00"), 2);
  await tapTable(page, "Window 1");
  await expect(page.getByRole("img", { name: "The view from Window 1" }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: /^Reserve this table – \$40$/ })).toBeVisible();

  // Sit here, then come back.
  await page.getByRole("button", { name: "Sit here" }).first().click();
  await page.getByRole("button", { name: /Back to the room/ }).click();

  // Swipe to Booth 2 to compare, then swipe back to Window 1.
  const carousel = page.locator("[data-carousel]").first();
  const title = page.locator("[data-card-title]:visible").first();
  const swipeTo = async (label: string, direction: 1 | -1) => {
    for (let i = 0; i < 20; i++) {
      const before = (await title.textContent())?.trim();
      if (before === label) return;
      await carousel.evaluate((el, d) => el.scrollBy({ left: d * el.clientWidth, behavior: "instant" }), direction);
      // Like a person, wait for the card to change before swiping again.
      await expect(title).not.toHaveText(before ?? "", { timeout: 5_000 });
    }
    throw new Error(`could not swipe to ${label}`);
  };
  await swipeTo("Booth 2", 1);
  await expect(page.getByRole("button", { name: /^Reserve this table – \$30$/ })).toBeVisible();
  await swipeTo("Window 1", -1);
  await expect(page.getByRole("button", { name: /^Reserve this table – \$40$/ })).toBeVisible();

  // Reserve: hold, details, Apple Pay (test), confirmed.
  await page.getByRole("button", { name: /^Reserve this table/ }).click();
  await expect(page.getByRole("timer")).toBeVisible();
  await page.getByLabel("Name").fill("Alex Morgan");
  await page.getByLabel("Email").fill(`alex+${info.project.name}-${Date.now()}@example.com`);
  await page.getByLabel("Mobile").fill("+1 415 555 0101");
  await page.getByLabel("Occasion").selectOption("anniversary");
  await page.getByRole("button", { name: /^Continue to payment/ }).click();
  await page.getByRole("radio", { name: /Apple Pay/ }).check();
  await page.getByRole("button", { name: "Pay $40" }).click();
  await expect(page.getByRole("heading", { name: /You.re at Window 1/ })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("img", { name: "The view from Window 1" }).first()).toBeVisible();

  const seconds = (Date.now() - started) / 1000;
  info.annotations.push({ type: "duration", description: `${seconds.toFixed(1)} s` });
  expect(seconds).toBeLessThan(90);

  // The booking is real: confirmed in the database at the server's price.
  const rows = await query<{ status: string; price_cents: number }>(
    `select r.status, r.price_cents from reservation r join venue_table t on t.id = r.table_id
     where t.code = 'W1' and r.venue_id = 'halcyon' and r.status = 'confirmed' order by r.created_at desc limit 1`,
  );
  expect(rows[0]).toMatchObject({ status: "confirmed", price_cents: 4000 });
});
