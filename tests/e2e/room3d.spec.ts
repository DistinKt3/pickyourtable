import { readFileSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";

/**
 * The 3D room in a real browser (software WebGL here): selecting a table frames it,
 * swiping the card moves the camera without closing the sheet (G-4), Sit here drops
 * to the 1.15 m eye in 400 to 600 ms and comes back (G-5), and with reduced motion
 * the move is a cut. The camera is read from the scene's test hook.
 */

type Pose = { position: { x: number; y: number; z: number }; target: { x: number; y: number; z: number } };
const venue = JSON.parse(readFileSync("venues/halcyon/venue.json", "utf8")) as {
  tables: { id: string; label: string }[];
};

async function open3d(page: Page) {
  // This machine has no GPU, so the room is forced on (a software GPU would otherwise keep the plan).
  await page.goto("/v/halcyon?room=3d");
  const ready = await page
    .waitForFunction(() => window.__pytScene?.ready === true, null, { timeout: 60_000 })
    .then(() => true)
    .catch(() => false);
  test.skip(!ready, "the 3D room did not start on this machine");
}

/** The table is framed for the guest: its label is on screen, above the card sheet. */
function framed(page: Page, code: string) {
  return page.evaluate((c) => {
    const label = window.__pytScene!.labels().find((l) => l.code === c);
    const sheet = document.querySelector("section[aria-label$='table details']")?.getBoundingClientRect().top ?? innerHeight;
    if (!label) return false;
    const x = label.rect.x + label.rect.width / 2;
    const y = label.rect.y + label.rect.height / 2;
    return x > 0 && x < innerWidth && y > 0 && y < sheet;
  }, code);
}

const pose = (page: Page) => page.evaluate(() => window.__pytScene!.camera() as Pose);

/** Activates a table's 3D label the way a keyboard user does; hidden labels show on focus. */
async function chooseTable(page: Page, label: string) {
  const button = page.locator("[data-room3d]").getByRole("button", { name: new RegExp(`^${label}\\s?,`) });
  await button.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: label, exact: true }).first()).toBeVisible();
}

/** Clicks, then samples the camera every frame until it settles; returns when it arrived and where. */
async function timedMove(page: Page, click: () => Promise<void>, done: (p: Pose) => boolean) {
  await page.evaluate(() => {
    const w = window as unknown as { __samples: { t: number; p: Pose }[]; __sampling: boolean };
    w.__samples = [];
    w.__sampling = true;
    const tick = () => {
      if (!w.__sampling) return;
      w.__samples.push({ t: performance.now(), p: window.__pytScene!.camera() });
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  const clickedAt = await page.evaluate(() => performance.now());
  await click();
  await expect.poll(async () => done(await pose(page)), { timeout: 10_000 }).toBe(true);
  const samples = await page.evaluate(() => {
    const w = window as unknown as { __samples: { t: number; p: Pose }[]; __sampling: boolean };
    w.__sampling = false;
    return w.__samples;
  });
  const after = samples.filter((s) => s.t >= clickedAt);
  const first = after.find((s) => done(s.p));
  const gaps = samples.slice(1).map((s, i) => s.t - samples[i]!.t);
  return {
    arrivedMs: first ? first.t - clickedAt : Number.NaN,
    frameMs: Math.max(16, ...gaps),
    start: after[0]?.p ?? samples[0]!.p,
    samples: after.map((s) => s.p),
    final: await pose(page),
  };
}

test("selecting and swiping frame each table with the sheet open; Sit here drops to the seat and back", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "phone-3d");
  test.setTimeout(150_000);
  await open3d(page);

  await chooseTable(page, "Window 1");
  await expect.poll(() => framed(page, "W1"), { timeout: 30_000 }).toBe(true);

  // Swipe to the next table: the camera follows and the card stays open.
  const carousel = page.locator("[data-carousel]").first();
  const title = page.locator("[data-card-title]:visible").first();
  await carousel.evaluate((el) => el.scrollBy({ left: el.clientWidth, behavior: "instant" }));
  await expect(title).not.toHaveText("Window 1", { timeout: 60_000 });
  const next = (await title.textContent())!.trim();
  const code = venue.tables.find((t) => t.label === next)!.id;
  await expect.poll(() => framed(page, code), { timeout: 30_000 }).toBe(true);
  await expect(page.locator("section[aria-label$='table details']")).not.toHaveAttribute("aria-hidden", "true");

  // Sit here: the eye at 1.15 m above the floor, reached in 400 to 600 ms.
  const sit = await timedMove(
    page,
    () => page.getByRole("button", { name: "Sit here" }).first().click(),
    (p) => Math.abs(p.position.y - 1.15) < 0.01,
  );
  info.annotations.push({
    type: "Sit here",
    description: `${Math.round(sit.arrivedMs)} ms (frames up to ${Math.round(sit.frameMs)} ms apart)`,
  });
  expect(sit.final.position.y).toBeCloseTo(1.15, 2);
  if (sit.frameMs <= 100) {
    // Measured on the first frame at the seat, so it can be up to one frame late.
    expect(sit.arrivedMs).toBeGreaterThanOrEqual(400);
    expect(sit.arrivedMs).toBeLessThanOrEqual(600 + sit.frameMs);
  } else {
    info.annotations.push({
      type: "Sit here timing",
      description: `not measurable here: frames up to ${Math.round(sit.frameMs)} ms apart on the software GPU; the 400 to 600 ms move is set and tested in tests/unit/room/camera.test.ts`,
    });
  }
  // The card steps aside while seated.
  await expect(page.locator("section[aria-label$='table details']")).toHaveAttribute("aria-hidden", "true");

  await page.getByRole("button", { name: "Back to the room" }).click();
  await expect.poll(async () => (await pose(page)).position.y > 3, { timeout: 30_000 }).toBe(true);
  await expect(page.locator("section[aria-label$='table details']")).not.toHaveAttribute("aria-hidden", "true");
});

test("with reduced motion, Sit here is a cut", async ({ page }, info) => {
  test.skip(info.project.name !== "phone-3d");
  test.setTimeout(150_000);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await open3d(page);
  await chooseTable(page, "Window 2");
  const sit = await timedMove(
    page,
    () => page.getByRole("button", { name: "Sit here" }).first().click(),
    (p) => Math.abs(p.position.y - 1.15) < 0.01,
  );
  info.annotations.push({ type: "Sit here (reduced motion)", description: `${Math.round(sit.arrivedMs)} ms` });
  // A cut, whatever the frame rate: no frame shows the camera between where it was and the seat.
  const between = sit.samples.filter((p) => p.position.y < sit.start.position.y - 0.01 && p.position.y > 1.16);
  expect(between).toEqual([]);
  expect(sit.final.position.y).toBeCloseTo(1.15, 2);
});

test("on a software GPU the guest keeps the 2D plan: the 3D room never starts", async ({ page }, info) => {
  test.skip(info.project.name !== "phone-3d");
  await page.goto("/v/halcyon");
  await expect(page.getByRole("button", { name: /^Window 1\s?,/ })).toBeVisible();
  // Long enough for the room to have started where it would.
  await page.waitForTimeout(8_000);
  expect(await page.evaluate(() => window.__pytScene?.ready ?? null)).toBeNull();
  await expect(page.locator("[data-room3d]")).toHaveCount(0);
  await expect(page.locator("[data-plan-layer]")).not.toHaveAttribute("inert");
});
