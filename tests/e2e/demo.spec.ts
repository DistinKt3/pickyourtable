import { expect, test } from "@playwright/test";
import { formatTimeLabel, nextFriday, pickSlot, query, tapTable } from "./helpers";

/**
 * The PRD demo script (M2 gate): open Halcyon on a phone, pick Friday 8:00 pm for 2,
 * tap Window 1, sit here, swipe to Booth 2 to compare, reserve with Apple Pay in test
 * mode, see the confirmation with the seat view. Must finish in under 90 seconds.
 */
test("demo script runs end to end in under 90 seconds", async ({ page }, info) => {
  const started = Date.now();
  const friday = nextFriday();
  await page.goto("/v/halcyon");
  await expect(page.getByRole("heading", { name: "Halcyon" })).toBeVisible();

  await pickSlot(page, friday, formatTimeLabel("20:00"), 2);
  await tapTable(page, "Window 1");
  await expect(page.getByRole("img", { name: "The view from Window 1" }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: /^Reserve this table – \$40$/ })).toBeVisible();

  // Sit here, then come back.
  await page.getByRole("button", { name: "Sit here" }).first().click();
  await page.getByRole("button", { name: /Back to the room/ }).click();

  // Swipe to Booth 2 to compare, then back to Window 1.
  const carousel = page.locator("[data-carousel]").first();
  const swipeTo = async (label: string) => {
    for (let i = 0; i < 20; i++) {
      if (await page.getByRole("heading", { name: label, exact: true }).first().isVisible()) return;
      await carousel.evaluate((el) => el.scrollBy({ left: el.clientWidth, behavior: "instant" }));
      await page.waitForTimeout(250);
    }
    throw new Error(`could not swipe to ${label}`);
  };
  await swipeTo("Booth 2");
  await expect(page.getByRole("button", { name: /^Reserve this table – \$30$/ })).toBeVisible();
  await tapTable(page, "Window 1");

  // Reserve: hold, details, Apple Pay (test), confirmed.
  await page.getByRole("button", { name: /^Reserve this table/ }).click();
  await expect(page.getByRole("timer")).toBeVisible();
  await page.getByLabel("Name").fill("Alex Morgan");
  await page.getByLabel("Email").fill(`alex+${info.project.name}-${Date.now()}@example.com`);
  await page.getByLabel("Mobile").fill("+1 415 555 0101");
  await page.getByLabel("Occasion").selectOption("anniversary");
  await page.getByRole("button", { name: /^Continue to payment/ }).click();
  await page.getByText("Apple Pay", { exact: true }).click();
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
