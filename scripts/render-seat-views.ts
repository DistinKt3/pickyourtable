/**
 * Renders the view from every bookable table's main seat (PRD "View from the seat")
 * against a running app, then writes the image set the table card and emails use:
 *
 *   public/venues/<id>/renders/<CODE>-640.avif|webp, <CODE>-1280.avif|webp, <CODE>-email.jpg
 *   public/venues/<id>/renders/manifest.json  (bytes per file, hash of venue.json)
 *
 * Usage: npx tsx --conditions=react-server scripts/render-seat-views.ts [venueId] [CODE...]
 * Needs the app running with the render route on (`next dev`, or PYT_RENDER_ROUTE=1),
 * at RENDER_BASE_URL (default http://localhost:3102).
 */
import "./_env";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "@playwright/test";
import sharp from "sharp";
import { tierOf } from "@/lib/room/types";
import { EYE_HEIGHT, SEAT_VIEW_ASPECT, SEAT_VIEW_FOCAL_MM } from "@/lib/venue/geometry";
import { listVenueIds, parseVenue } from "@/lib/venue/load";
import { SEAT_VIEW_SIZE } from "@/lib/venue/media";

const BASE = process.env.RENDER_BASE_URL ?? "http://localhost:3102";
const BUDGET_640 = 250 * 1024;
const VIEWPORT = { width: 1920, height: 1280 };
// 2880 x 1920: 2.25x the largest output, enough supersampling at about half the time of 2x.
const SCALE = 1.5;
const SIZES = [
  { width: 640, height: Math.round(640 / SEAT_VIEW_ASPECT) },
  { width: SEAT_VIEW_SIZE.width, height: SEAT_VIEW_SIZE.height },
] as const;

interface FileEntry {
  bytes: number;
}

async function encode(png: Buffer, dir: string, code: string): Promise<Record<string, FileEntry>> {
  const files: Record<string, FileEntry> = {};
  const write = async (name: string, data: Buffer) => {
    await writeFile(path.join(dir, name), data);
    files[name] = { bytes: data.length };
  };
  for (const s of SIZES) {
    // Lanczos from the large capture: the supersampling pass.
    const base = sharp(png).resize(s.width, s.height, { fit: "cover", kernel: "lanczos3" });
    const sharpened = s.width <= 640 ? base.clone().sharpen({ sigma: 0.5 }) : base.clone();
    let avifQ = 58;
    let avif = await sharpened.clone().avif({ quality: avifQ, effort: 6, chromaSubsampling: "4:4:4" }).toBuffer();
    while (s.width <= 640 && avif.length > BUDGET_640 && avifQ > 30) {
      avifQ -= 6;
      avif = await sharpened.clone().avif({ quality: avifQ, effort: 6, chromaSubsampling: "4:4:4" }).toBuffer();
    }
    let webpQ = 84;
    let webp = await sharpened.clone().webp({ quality: webpQ, effort: 6, smartSubsample: true }).toBuffer();
    while (s.width <= 640 && webp.length > BUDGET_640 && webpQ > 40) {
      webpQ -= 6;
      webp = await sharpened.clone().webp({ quality: webpQ, effort: 6, smartSubsample: true }).toBuffer();
    }
    await write(`${code}-${s.width}.avif`, avif);
    await write(`${code}-${s.width}.webp`, webp);
  }
  const email = await sharp(png)
    .resize(600, 400, { fit: "cover", kernel: "lanczos3" })
    .sharpen({ sigma: 0.5 })
    .jpeg({ quality: 82, mozjpeg: true, progressive: true })
    .toBuffer();
  await write(`${code}-email.jpg`, email);
  return files;
}

async function main() {
  const [venueArg, ...codesArg] = process.argv.slice(2);
  const ids = venueArg ? [venueArg] : await listVenueIds();
  const browser = await chromium.launch({
    executablePath: process.env.PW_CHROMIUM ?? "/opt/pw-browsers/chromium",
    args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
  });
  let failed = false;
  try {
    for (const id of ids) {
      const file = path.join("venues", id, "venue.json");
      const json = await readFile(file, "utf8");
      const venue = parseVenue(json, file);
      const dir = path.join("public", "venues", id, "renders");
      await mkdir(dir, { recursive: true });
      const manifestPath = path.join(dir, "manifest.json");
      let previous: { tables?: Record<string, unknown> } = {};
      try {
        previous = JSON.parse(await readFile(manifestPath, "utf8"));
      } catch {
        previous = {};
      }
      const bookable = venue.tables.filter((t) => t.bookable ?? tierOf(venue, t.tier).bookable);
      const todo = codesArg.length ? bookable.filter((t) => codesArg.includes(t.id)) : bookable;
      const tables: Record<string, unknown> = codesArg.length ? { ...previous.tables } : {};
      // Written after every table, so an interrupted run keeps what it finished and can
      // resume with the remaining codes.
      const writeManifest = async () => {
        const manifest = {
          venue: id,
          venueSha256: createHash("sha256").update(json).digest("hex"),
          camera: { eyeHeightM: EYE_HEIGHT, focalMm: SEAT_VIEW_FOCAL_MM, aspect: "3:2" },
          capture: { width: VIEWPORT.width * SCALE, height: VIEWPORT.height * SCALE },
          tables: Object.fromEntries(Object.entries(tables).sort(([a], [b]) => (a < b ? -1 : 1))),
        };
        await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
      };
      for (const t of todo) {
        const started = Date.now();
        const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: SCALE, colorScheme: "light" });
        const page = await context.newPage();
        page.on("pageerror", (e) => console.error(`${id}/${t.id}: ${e.message}`));
        const res = await page.goto(`${BASE}/render/${id}/${t.id}`, { waitUntil: "domcontentloaded", timeout: 180_000 });
        if (!res?.ok()) throw new Error(`${id}/${t.id}: render route answered ${res?.status()}`);
        await page.waitForFunction(() => window.__renderReady === true, null, { timeout: 600_000, polling: 1000 });
        // The render canvas keeps its drawing buffer: read the exact pixels, at full size.
        const dataUrl = await page.evaluate(() => document.querySelector("canvas")!.toDataURL("image/png"));
        const png = Buffer.from(dataUrl.slice(dataUrl.indexOf(",") + 1), "base64");
        await context.close();
        const files = await encode(png, dir, t.id);
        const small = Math.max(files[`${t.id}-640.avif`]!.bytes, files[`${t.id}-640.webp`]!.bytes);
        if (small > BUDGET_640) {
          console.error(`${id}/${t.id}: 640 px image is ${small} bytes, over the ${BUDGET_640} byte budget`);
          failed = true;
        }
        tables[t.id] = { label: t.label, files };
        await writeManifest();
        console.log(JSON.stringify({ event: "render.seat", venue: id, table: t.id, ms: Date.now() - started, bytes640: small }));
      }
      await writeManifest();
    }
  } finally {
    await browser.close();
  }
  if (failed) process.exit(1);
}

declare global {
  interface Window {
    __renderReady?: boolean;
  }
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
