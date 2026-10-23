import { expect, test } from "@playwright/test";
import { query } from "./helpers";

/** PRD S-5: turning off pyt_widget_enabled hides the widget within 60 s and shows a fallback. */
test("kill switch hides the widget and refuses guest APIs, then restores", async ({ page, request }) => {
  test.setTimeout(150_000);
  await query(`update feature_flag set enabled = false, updated_at = now() where key = 'pyt_widget_enabled'`);
  const off = Date.now();
  try {
    await expect
      .poll(
        async () => {
          await page.goto("/v/halcyon");
          return page.getByText("Online table selection is paused right now").isVisible();
        },
        { timeout: 60_000, intervals: [2_000] },
      )
      .toBe(true);
    test.info().annotations.push({ type: "hidden after", description: `${((Date.now() - off) / 1000).toFixed(1)} s` });
    await expect(page.getByRole("link", { name: "(415) 555-0142" })).toBeVisible();
    const res = await request.get("/api/v/halcyon/availability?date=2030-01-04&time=19:00&party=2");
    expect(res.status()).toBe(503);
    expect((await res.json()).error.code).toBe("widget_disabled");
  } finally {
    await query(`update feature_flag set enabled = true, updated_at = now() where key = 'pyt_widget_enabled'`);
  }
  await expect
    .poll(
      async () => {
        await page.goto("/v/halcyon");
        return page.getByRole("heading", { name: "Halcyon" }).isVisible();
      },
      { timeout: 60_000, intervals: [2_000] },
    )
    .toBe(true);
});
