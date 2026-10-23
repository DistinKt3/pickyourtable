import { existsSync } from "node:fs";
import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:3100";
// This machine ships an older Chromium than Playwright 1.64 expects; CI installs its own.
const executablePath =
  process.env.PW_CHROMIUM_PATH ?? (existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);

const SOFTWARE_GPU = ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"];
const NO_WEBGL = ["--disable-webgl", "--disable-webgl2", "--disable-3d-apis"];
const launch = (args: string[]) => ({ ...(executablePath ? { executablePath } : {}), args });
const PHONE = { browserName: "chromium" as const, viewport: { width: 390, height: 844 } };
const DESKTOP = { browserName: "chromium" as const, viewport: { width: 1440, height: 900 } };
/** Specs about the 3D room: they run only in the 3D projects. */
const ROOM_ONLY = /(room3d|a11y-3d|layout-truth|budgets|screens)\.spec\.ts$/;
/** What the 3D projects run: the room specs and the demo script. */
const ROOM = /(room3d|a11y-3d|layout-truth|budgets|screens|demo)\.spec\.ts$/;

export default defineConfig({
  testDir: "tests/e2e",
  outputDir: "test-results",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 120_000,
  expect: { timeout: 10_000 },
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    // E2E_VIDEO=1 records every test (the demo recording in the gate report).
    video: process.env.E2E_VIDEO ? "on" : "off",
  },
  // The booking, portal and timing specs run with WebGL off: the 3D room renders on a
  // software GPU here, and its multi-second frames would make every timing about this
  // machine. The 3D projects run what is about the room itself (and the demo, in both).
  projects: [
    { name: "phone", testIgnore: ROOM_ONLY, use: { ...devices["iPhone 13"], ...PHONE, launchOptions: launch(NO_WEBGL) } },
    { name: "desktop", testIgnore: ROOM_ONLY, use: { ...DESKTOP, launchOptions: launch(NO_WEBGL) } },
    { name: "phone-3d", testMatch: ROOM, use: { ...devices["iPhone 13"], ...PHONE, launchOptions: launch(SOFTWARE_GPU) } },
    { name: "desktop-3d", testMatch: ROOM, use: { ...DESKTOP, launchOptions: launch(SOFTWARE_GPU) } },
  ],
  webServer: {
    command: "bash scripts/e2e-server.sh",
    url: `${baseURL}/api/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 900_000,
    stdout: "ignore",
    stderr: "pipe",
  },
});
