/**
 * The 3D room's screenshot loop: captures the dev review page for both venues at
 * 390 x 844 (phone, 3x) and 1440 x 900, light and dark, in five states each, into
 * tests/screens/__output__/3d/. Waits for `window.__pytScene.ready`.
 *
 * Usage: npx tsx scripts/screens-3d.ts [venueId] [state]
 * Needs the dev server at SCREENS_BASE_URL (default http://localhost:3102).
 */
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { chromium, type Page } from "@playwright/test";
import type { SceneTestHook } from "@/components/room/scene3d/Scene";

const BASE = process.env.SCREENS_BASE_URL ?? "http://localhost:3102";
const OUT = path.join("tests", "screens", "__output__", "3d");

const STATES: Record<string, Record<string, string>> = {
  halcyon: {
    browse: "",
    slot: "?slot=1&taken=W2,B1,C2&wrong=T1,T3",
    "selected-W1": "?slot=1&taken=W2,B1,C2&wrong=T1,T3&selected=W1",
    "sit-W1": "?slot=1&sit=W1",
    "selected-B2": "?slot=1&selected=B2",
  },
  "orchard-room": {
    browse: "",
    slot: "?slot=1&taken=G2,N1&wrong=N3",
    "selected-G1": "?slot=1&taken=G2,N1&wrong=N3&selected=G1",
    "sit-G1": "?slot=1&sit=G1",
    "selected-N2": "?slot=1&selected=N2",
  },
};

const VIEWPORTS = [
  { name: "phone", width: 390, height: 844, scale: 3, mobile: true },
  { name: "desktop", width: 1440, height: 900, scale: 1, mobile: false },
] as const;

const SCHEMES = ["light", "dark"] as const;

type Hook = SceneTestHook;

async function capture(page: Page, url: string, file: string) {
  const res = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 180_000 });
  if (!res?.ok()) throw new Error(`${url} answered ${res?.status()}`);
  await page.waitForFunction(() => window.__pytScene?.ready === true, null, { timeout: 300_000, polling: 500 });
  // Labels fade in over 200 ms after the first frame.
  await page.waitForTimeout(900);
  await page.screenshot({ path: file, timeout: 120_000 });
  const info = await page.evaluate(() => {
    const s: Hook = window.__pytScene!;
    const labels = s.labels().filter((l) => l.visible);
    for (let i = 0; i < labels.length; i++) {
      for (let j = i + 1; j < labels.length; j++) {
        const a = labels[i]!.rect;
        const b = labels[j]!.rect;
        if (a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height) {
          return { overlap: `${labels[i]!.code}/${labels[j]!.code}`, ...s.info(), camera: s.camera() };
        }
      }
    }
    return { overlap: null, labels: labels.length, ...s.info(), camera: s.camera() };
  });
  return info;
}

async function main() {
  const [venueArg, stateArg] = process.argv.slice(2);
  await mkdir(OUT, { recursive: true });
  const browser = await chromium.launch({
    executablePath: process.env.PW_CHROMIUM ?? "/opt/pw-browsers/chromium",
    args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
  });
  let overlaps = 0;
  try {
    for (const [venue, states] of Object.entries(STATES)) {
      if (venueArg && venue !== venueArg) continue;
      for (const vp of VIEWPORTS) {
        for (const scheme of SCHEMES) {
          const context = await browser.newContext({
            viewport: { width: vp.width, height: vp.height },
            deviceScaleFactor: vp.scale,
            isMobile: vp.mobile,
            hasTouch: vp.mobile,
            colorScheme: scheme,
          });
          const page = await context.newPage();
          page.on("pageerror", (e) => console.error(`${venue} ${vp.name} ${scheme}: ${e.message}`));
          for (const [state, query] of Object.entries(states)) {
            if (stateArg && state !== stateArg) continue;
            const file = path.join(OUT, `${venue}-${state}-${vp.name}-${scheme}.png`);
            const started = Date.now();
            const info = await capture(page, `${BASE}/dev/room/${venue}${query}`, file);
            if (info.overlap) overlaps++;
            console.log(JSON.stringify({ file, ms: Date.now() - started, ...info }));
          }
          await context.close();
        }
      }
    }
  } finally {
    await browser.close();
  }
  if (overlaps) {
    console.error(`${overlaps} screenshot(s) had overlapping labels`);
    process.exit(1);
  }
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
