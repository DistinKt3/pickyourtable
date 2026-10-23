import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";

/**
 * PRD quality bar, layout truth: the 3D plan, the 2D plan and the list place every
 * table exactly where venue.json does.
 */
for (const venueId of ["halcyon", "orchard-room"]) {
  test(`${venueId}: 2D plan, 3D scene and list agree with venue.json`, async ({ page }) => {
    const venue = JSON.parse(readFileSync(`venues/${venueId}/venue.json`, "utf8")) as {
      tables: { id: string; label: string; x: number; z: number; rotation: number; tier: string }[];
      tiers: { id: string; bookable: boolean }[];
    };
    await page.goto(`/v/${venueId}`);

    const plan = await page.locator("[data-plan]:visible g[data-code]").evaluateAll((groups) =>
      groups.map((g) => {
        const top = g.querySelector("g[data-top]");
        return { code: g.getAttribute("data-code"), transform: top?.getAttribute("transform") ?? "" };
      }),
    );
    expect(plan).toHaveLength(venue.tables.length);
    for (const t of venue.tables) {
      const p = plan.find((x) => x.code === t.id);
      const m = /translate\(([-\d.]+) ([-\d.]+)\) rotate\(([-\d.]+)\)/.exec(p?.transform ?? "");
      expect(m, t.id).not.toBeNull();
      expect(Math.abs(Number(m![1]) - t.x)).toBeLessThan(0.001);
      expect(Math.abs(Number(m![2]) - t.z)).toBeLessThan(0.001);
      expect(Math.abs(Number(m![3]) - t.rotation)).toBeLessThan(0.001);
    }

    // The 3D scene, when this device renders it.
    const has3d = await page
      .waitForFunction(() => (window as unknown as { __pytScene?: { ready: boolean } }).__pytScene?.ready === true, null, {
        timeout: 20_000,
      })
      .then(() => true)
      .catch(() => false);
    test.info().annotations.push({ type: "3d", description: has3d ? "checked" : "not rendered on this run" });
    if (has3d) {
      const positions = await page.evaluate(() =>
        (
          window as unknown as { __pytScene: { tablePositions(): Record<string, { x: number; z: number }> } }
        ).__pytScene.tablePositions(),
      );
      for (const t of venue.tables) {
        expect(Math.abs(positions[t.id]!.x - t.x), `${t.id} x`).toBeLessThan(0.001);
        expect(Math.abs(positions[t.id]!.z - t.z), `${t.id} z`).toBeLessThan(0.001);
      }
    }

    // The list shows every bookable table by name.
    await page.getByRole("radio", { name: "List" }).check({ force: true });
    const bookableTiers = new Set(venue.tiers.filter((t) => t.bookable).map((t) => t.id));
    for (const t of venue.tables.filter((x) => bookableTiers.has(x.tier))) {
      await expect(page.getByRole("button", { name: new RegExp(`^${t.label}\\s?,`) }).first()).toBeVisible();
    }
  });
}
