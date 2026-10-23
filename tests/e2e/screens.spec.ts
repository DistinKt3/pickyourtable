import { mkdirSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";
import { formatTimeLabel, nextFriday, pickSlot, tapTable } from "./helpers";

/**
 * Device screenshot matrix for design review and the gate report. Runs only with
 * SCREENS=1. WebKit (Safari) is not installed on this machine, so Safari is listed
 * as not run in the gate report rather than emulated.
 */
test.skip(!process.env.SCREENS, "set SCREENS=1 to capture the matrix");

const DEVICES = [
  { name: "iphone-13", width: 390, height: 844, scale: 3, mobile: true },
  { name: "iphone-16-pro", width: 402, height: 874, scale: 3, mobile: true },
  { name: "pixel-6a", width: 412, height: 915, scale: 2.625, mobile: true },
  { name: "galaxy-a35", width: 412, height: 892, scale: 2.625, mobile: true },
  { name: "ipad", width: 820, height: 1180, scale: 2, mobile: true },
  { name: "desktop-chrome", width: 1440, height: 900, scale: 1, mobile: false },
] as const;

const OUT = "tests/screens/__output__/matrix";

test("capture the device matrix", async ({ browser }, info) => {
  test.skip(info.project.name !== "desktop-3d", "one pass is enough");
  test.setTimeout(900_000);
  mkdirSync(OUT, { recursive: true });
  const friday = nextFriday();
  for (const d of DEVICES) {
    for (const scheme of ["light", "dark"] as const) {
      const ctx = await browser.newContext({
        viewport: { width: d.width, height: d.height },
        deviceScaleFactor: d.scale,
        isMobile: d.mobile,
        hasTouch: d.mobile,
        colorScheme: scheme,
      });
      const page = await ctx.newPage();
      const shot = async (state: string) => {
        await page.waitForTimeout(700);
        await page.screenshot({ path: `${OUT}/${d.name}-${scheme}-${state}.png` });
      };
      await page.goto("/v/halcyon?room=3d");
      await expect(page.getByRole("heading", { name: "Halcyon" })).toBeVisible();
      await waitFor3d(page);
      await shot("1-room");
      await pickSlot(page, friday, formatTimeLabel("20:00"), 2);
      await shot("2-slot");
      await tapTable(page, "Window 1");
      await shot("3-card");
      await page.getByRole("radio", { name: "List" }).check({ force: true });
      await shot("4-list");
      await ctx.close();
    }
  }
});

async function waitFor3d(page: Page) {
  await page
    .waitForFunction(() => (window as unknown as { __pytScene?: { ready: boolean } }).__pytScene?.ready === true, null, {
      timeout: 30_000,
    })
    .catch(() => undefined);
}
