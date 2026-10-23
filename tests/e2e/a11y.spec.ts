import { AxeBuilder } from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import { addDays, expectBodyText16, formatTimeLabel, nextWeekday, pickSlot } from "./helpers";

/**
 * PRD G-10: with WebGL off the whole flow completes, and axe reports zero WCAG 2.2 AA
 * violations on every step.
 */
test.use({
  launchOptions: {
    executablePath: process.env.PW_CHROMIUM_PATH ?? "/opt/pw-browsers/chromium",
    args: ["--disable-webgl", "--disable-webgl2", "--disable-3d-apis"],
  },
});

const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

async function axe(page: Page, label: string) {
  const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  const summary = results.violations.map((v) => `${v.id}: ${v.nodes.length} (${v.nodes[0]?.target.join(" ")})`);
  expect(summary, `${label}: ${summary.join("; ")}`).toEqual([]);
  await expectBodyText16(page, label);
}

test("the whole booking flow works without WebGL and passes axe at every step", async ({ page }, info) => {
  await page.goto("/v/halcyon");
  const webgl = await page.evaluate(() => Boolean(document.createElement("canvas").getContext("webgl2")));
  expect(webgl).toBe(false);
  await axe(page, "room");

  await page.getByRole("radio", { name: "List" }).check({ force: true });
  await axe(page, "list");

  // A Tuesday, so the slot is a weeknight; each project and repeat has its own, two weeks
  // apart, so runs never hold the same table (guest-states books the Tuesday in between).
  const date = addDays(nextWeekday(2, 2), 14 * (2 * info.repeatEachIndex + (info.project.name === "phone" ? 0 : 1)));
  await pickSlot(page, date, formatTimeLabel("19:00"), 2);
  await axe(page, "list with availability");

  await page
    .getByRole("button", { name: /^Window 3\s?,/ })
    .first()
    .click();
  await expect(page.getByRole("heading", { name: "Window 3", exact: true }).first()).toBeVisible();
  await axe(page, "table card");

  await page.getByRole("button", { name: /^Reserve this table/ }).click();
  await expect(page.getByRole("timer")).toBeVisible();
  await axe(page, "details");

  await page.getByLabel("Name").fill("Sam Rivera");
  await page.getByLabel("Email").fill(`sam+${info.project.name}-${Date.now()}@example.com`);
  await page.getByLabel("Mobile").fill("(415) 555-0199");
  await page.getByRole("button", { name: /^Continue to payment/ }).click();
  await expect(page.getByRole("button", { name: /^Pay \$/ })).toBeVisible();
  await axe(page, "payment");

  await page.getByRole("button", { name: /^Pay \$/ }).click();
  await expect(page.getByRole("heading", { name: /You.re at Window 3/ })).toBeVisible({ timeout: 30_000 });
  await axe(page, "confirmation");

  const manage = await page.getByRole("link", { name: "Manage booking" }).getAttribute("href");
  expect(manage).toBeTruthy();
  await page.goto(manage!);
  await expect(page.getByRole("heading", { name: "Window 3" })).toBeVisible();
  await axe(page, "manage");
});

test("every table has a screen-reader label in the plan and the list", async ({ page }) => {
  await page.goto("/v/halcyon");
  const plan = await page
    .locator('[data-plan] g[role="button"]:visible')
    .evaluateAll((els) => els.map((e) => e.getAttribute("aria-label") ?? ""));
  expect(plan.length).toBe(25);
  for (const label of plan) expect(label).toMatch(/^[A-Z][\w ]+ \d+, .+, \d seats, /);
});
