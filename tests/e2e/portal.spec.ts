import { AxeBuilder } from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { addDays, expectBodyText16, formatTimeLabel, nextWeekday, pickSlot, signIn, tapTable } from "./helpers";

/**
 * The operator side of the M3 gate: a host signs in through the real magic link (read
 * from the dev mail store), opens Tonight for a date, and a guest booking made in
 * another browser appears there with its PAID badge within 2 seconds of payment
 * (PRD O-1).
 */

const TZ = "America/Los_Angeles";
const HOST = "host@halcyon.example";
const OWNER = "owner@halcyon.example";

test("a guest booking appears on Tonight with a PAID badge within 2 seconds", async ({ browser, page }, info) => {
  test.skip(info.project.name !== "desktop");
  const date = addDays(nextWeekday(1, 9, TZ), 7 * info.repeatEachIndex); // a Monday, its own date
  const guestName = `Jordan Reyes ${Date.now().toString(36)}`;

  await signIn(page, HOST);
  await page.goto(`/portal/tonight?date=${date}`);
  const rows = page.getByRole("listitem").filter({ hasText: guestName });
  await expect(rows).toHaveCount(0);

  const guestContext = await browser.newContext();
  const guest = await guestContext.newPage();
  try {
    await guest.goto("/v/halcyon");
    await pickSlot(guest, date, formatTimeLabel("19:00"), 2);
    await tapTable(guest, "Booth 1");
    await guest.getByRole("button", { name: /^Reserve this table/ }).click();
    await guest.getByLabel("Name").fill(guestName);
    await guest.getByLabel("Email").fill(`jordan+${Date.now()}@example.com`);
    await guest.getByLabel("Mobile").fill("+1 415 555 0144");
    await guest.getByRole("button", { name: /^Continue to payment/ }).click();
    await guest.getByRole("radio", { name: /Visa ending 4242/ }).check();
    await guest.getByRole("button", { name: /^Pay \$/ }).click();
    await expect(guest.getByRole("heading", { name: /You.re at Booth 1/ })).toBeVisible({ timeout: 30_000 });
  } finally {
    await guestContext.close();
  }

  // Measured from the moment the guest sees "You're at": the payment is confirmed by then.
  const paidAt = Date.now();
  const row = page.getByRole("listitem").filter({ hasText: guestName });
  await expect(row.getByText(/^Paid \$\d/)).toBeVisible({ timeout: 2_000 });
  const ms = Date.now() - paidAt;
  info.annotations.push({ type: "tonight-latency", description: `${ms} ms` });
  await expect(row).toContainText("Booth 1");
  await expect(row).toContainText(/7:00\s?pm/);
  // A later date is for looking ahead: no arrival actions until the night.
  await expect(row).toContainText("Booked");
  await expect(row.getByRole("button", { name: /^Mark .* seated/ })).toHaveCount(0);
  await expect(row.getByRole("button", { name: /no-show$/ })).toHaveCount(0);
});

test("every portal screen passes axe (WCAG 2.2 AA) and the 16 px body-text rule", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop");
  await page.goto("/portal/sign-in");
  const check = async (label: string) => {
    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
    const summary = results.violations.map((v) => `${v.id}: ${v.nodes.length} (${v.nodes[0]?.target.join(" ")})`);
    expect(summary, `${label}: ${summary.join("; ")}`).toEqual([]);
    await expectBodyText16(page, label);
  };
  await check("sign-in");
  await signIn(page, OWNER);
  for (const [path, heading] of [
    ["/portal/tonight", "Tonight"],
    ["/portal/bookings", "Bookings"],
    ["/portal/tables", "Tables and pricing"],
    ["/portal/blackouts", "Blackouts"],
    ["/portal/review", "Venue review"],
  ] as const) {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1 })).toContainText(heading);
    await check(path);
  }
});
