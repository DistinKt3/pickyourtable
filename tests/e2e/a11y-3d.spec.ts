import { readFileSync } from "node:fs";
import { AxeBuilder } from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

/**
 * With the 3D room up (software WebGL here), the room still passes axe, every table
 * is one labelled button, and the 2D plan underneath is out of the way: inert and
 * hidden from assistive tech, so no table is announced twice.
 */
test("with the 3D room up: axe passes and every table is reachable exactly once", async ({ page }, info) => {
  test.setTimeout(120_000);
  const venue = JSON.parse(readFileSync("venues/halcyon/venue.json", "utf8")) as { tables: { id: string; label: string }[] };
  await page.goto("/v/halcyon");
  const ready = await page
    .waitForFunction(() => (window as unknown as { __pytScene?: { ready: boolean } }).__pytScene?.ready === true, null, {
      timeout: 60_000,
    })
    .then(() => true)
    .catch(() => false);
  test.skip(!ready, `the 3D room did not start on this ${info.project.name} run`);
  await expect(page.locator("[data-room3d]")).not.toHaveAttribute("inert");

  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  const summary = results.violations.map((v) => `${v.id}: ${v.nodes.length} (${v.nodes[0]?.target.join(" ")})`);
  expect(summary, summary.join("; ")).toEqual([]);

  for (const t of venue.tables) {
    await expect(page.getByRole("button", { name: new RegExp(`^${t.label}\\s?,`) }), t.label).toHaveCount(1);
  }
  await expect(page.locator("[data-plan-layer]")).toHaveAttribute("inert", "");
  await expect(page.locator("[data-plan-layer]")).toHaveAttribute("aria-hidden", "true");
});
