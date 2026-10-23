import { mkdirSync } from "node:fs";
import { chromium, type Page } from "@playwright/test";

/**
 * Screenshot loop for the guest widget: phone and desktop, light and dark.
 *   npx tsx tests/screens/capture.ts [baseUrl] [outDir] [scenario...]
 */

const base = process.argv[2] ?? "http://localhost:3000";
const out = process.argv[3] ?? "tests/screens/__output__/guest";
const only = process.argv.slice(4);
mkdirSync(out, { recursive: true });

const viewports = [
  { name: "phone", width: 390, height: 844, scale: 3, mobile: true },
  { name: "desktop", width: 1440, height: 900, scale: 1, mobile: false },
] as const;

type Scenario = { name: string; path: string; act?: (p: Page, vp: (typeof viewports)[number]) => Promise<void> };

const scenarios: Scenario[] = [
  { name: "browse", path: "/v/halcyon?renderer=2d" },
  {
    name: "card-browse",
    path: "/v/halcyon?renderer=2d",
    act: async (p) => {
      await p.locator('[data-plan] g[data-code="W1"]:visible').first().click();
      await p.waitForTimeout(700);
    },
  },
  {
    name: "list",
    path: "/v/halcyon?renderer=2d",
    act: async (p) => {
      await p.getByText("List", { exact: true }).first().click();
      await p.waitForTimeout(400);
    },
  },
  { name: "orchard", path: "/v/orchard-room?renderer=2d" },
];

const browser = await chromium.launch({
  executablePath: "/opt/pw-browsers/chromium",
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
});
for (const vp of viewports) {
  for (const scheme of ["light", "dark"] as const) {
    const ctx = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      deviceScaleFactor: vp.scale,
      isMobile: vp.mobile,
      hasTouch: vp.mobile,
      colorScheme: scheme,
    });
    for (const s of scenarios) {
      if (only.length && !only.includes(s.name)) continue;
      const page = await ctx.newPage();
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
      await page.goto(base + s.path, { waitUntil: "networkidle" });
      await page.waitForTimeout(500);
      if (s.act) await s.act(page, vp);
      const file = `${out}/${s.name}-${vp.name}-${scheme}.png`;
      await page.screenshot({ path: file });
      console.log(file, errors.length ? `ERRORS: ${errors.slice(0, 3).join(" | ")}` : "");
      await page.close();
    }
    await ctx.close();
  }
}
await browser.close();
