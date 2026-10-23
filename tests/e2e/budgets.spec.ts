import { expect, test } from "@playwright/test";

/**
 * PRD G-1 and the architecture budgets, measured in Chromium:
 * - 2D plan interactive in 2.5 s or less on Fast 4G with an iPhone 13 profile
 * - initial JavaScript 250 KB or less, compressed
 * - 3D in within 4 s (reported; a software GPU here is far slower than a phone's)
 *
 * Fast 4G here is 9 Mbps down, 1.5 Mbps up, 170 ms round trip, with the CPU slowed 4x.
 */
test.skip(({ browserName }) => browserName !== "chromium", "needs the Chrome DevTools Protocol");

test("speed and size budgets", async ({ page }, info) => {
  test.skip(info.project.name !== "phone-3d", "measured on the phone profile, with the 3D room");
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
  await cdp.send("Network.emulateNetworkConditions", {
    offline: false,
    latency: 170,
    downloadThroughput: (9_000_000 / 8) | 0,
    uploadThroughput: (1_500_000 / 8) | 0,
  });
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });

  const types = new Map<string, string>();
  const scripts: { url: string; bytes: number; at: number }[] = [];
  const urls = new Map<string, string>();
  cdp.on("Network.responseReceived", (e) => {
    types.set(e.requestId, e.type);
    urls.set(e.requestId, e.response.url);
  });
  cdp.on("Network.loadingFinished", (e) => {
    if (types.get(e.requestId) === "Script")
      scripts.push({ url: urls.get(e.requestId) ?? "", bytes: e.encodedDataLength, at: Date.now() });
  });

  // Long main-thread tasks, to see what the 3D load costs the page (reported only).
  await page.addInitScript(() => {
    const w = window as unknown as { __longTasks: number[] };
    w.__longTasks = [];
    try {
      new PerformanceObserver((list) => {
        for (const e of list.getEntries()) w.__longTasks.push(e.duration);
      }).observe({ type: "longtask", buffered: true });
    } catch {
      /* not supported */
    }
  });
  await page.goto("/v/halcyon", { waitUntil: "commit" });
  await page.waitForFunction(() => performance.getEntriesByName("pyt:interactive").length > 0, null, { timeout: 30_000 });
  const interactiveWall = Date.now();
  const marks = await page.evaluate(() => {
    const paint = performance.getEntriesByName("first-contentful-paint")[0];
    return {
      interactive: performance.getEntriesByName("pyt:interactive")[0]!.startTime,
      fcp: paint ? paint.startTime : null,
    };
  });
  const initialKb = scripts.filter((s) => s.at <= interactiveWall).reduce((sum, s) => sum + s.bytes, 0) / 1024;

  const threeD = await page
    .waitForFunction(() => performance.getEntriesByName("pyt:3d-ready").length > 0, null, { timeout: 20_000 })
    .then(() => page.evaluate(() => performance.getEntriesByName("pyt:3d-ready")[0]!.startTime))
    .catch(() => null);

  info.annotations.push(
    { type: "2D interactive", description: `${Math.round(marks.interactive)} ms` },
    { type: "first contentful paint", description: marks.fcp ? `${Math.round(marks.fcp)} ms` : "n/a" },
    {
      type: "initial JS (compressed)",
      description: `${initialKb.toFixed(1)} KB in ${scripts.filter((s) => s.at <= interactiveWall).length} files`,
    },
    { type: "3D ready", description: threeD ? `${Math.round(threeD)} ms (software GPU)` : "not reached on this machine" },
  );
  const longTasks = await page.evaluate(() => (window as unknown as { __longTasks: number[] }).__longTasks);
  info.annotations.push({
    type: "longest main-thread task",
    description: longTasks.length
      ? `${Math.round(Math.max(...longTasks))} ms of ${longTasks.length} long tasks (software GPU, CPU slowed 4x)`
      : "none",
  });

  console.log(JSON.stringify({ budgets: info.annotations }));

  expect(marks.interactive).toBeLessThan(2500);
  expect(initialKb).toBeLessThan(250);
});
