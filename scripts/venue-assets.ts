/**
 * Venue media pipeline (PRD D-2, D-3). For each venue folder:
 *
 * - Real seat photos at venues/<id>/photos/<photoId>.(jpg|jpeg|png|webp|avif) become
 *   public/venues/<id>/photos/<photoId>-640.avif|webp, -1280.avif|webp and -email.jpg,
 *   the same set the renders use, so a photo replaces a render by photo ID alone.
 * - venues/<id>/model.glb (optional) is copied to public/venues/<id>/model.glb, and
 *   the run fails if it is over the 3 MB budget.
 *
 * Usage: npx tsx --conditions=react-server scripts/venue-assets.ts [venueId]
 *
 * Development check of the model path: `--export-dev-shell` exports the room shell
 * the scene builds from venue.json as a GLB into artifacts/tmp/dev-shell/<id>.glb
 * (not shipped); open /dev/room/<id>?model=dev to load it through the model loader.
 */
import "./_env";
import { copyFile, mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import * as THREE from "three";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
import { buildShell } from "@/components/room/scene3d/geometry/shell";
import { LIGHT } from "@/components/room/scene3d/palette";
import { SEAT_VIEW_ASPECT } from "@/lib/venue/geometry";
import { listVenueIds, loadVenue } from "@/lib/venue/load";
import { SEAT_VIEW_SIZE } from "@/lib/venue/media";

const MODEL_BUDGET = 3 * 1024 * 1024;
const PHOTO_BUDGET_640 = 250 * 1024;
const PHOTO = /^([a-z0-9][a-z0-9-]{0,63})\.(jpe?g|png|webp|avif)$/i;
export const DEV_SHELL_DIR = path.join("artifacts", "tmp", "dev-shell");

async function exists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

async function photos(id: string, referenced: Set<string>): Promise<number> {
  const src = path.join("venues", id, "photos");
  if (!(await exists(src))) return 0;
  const out = path.join("public", "venues", id, "photos");
  await mkdir(out, { recursive: true });
  let count = 0;
  for (const name of (await readdir(src)).sort()) {
    const m = PHOTO.exec(name);
    if (!m) continue;
    const photoId = m[1]!.toLowerCase();
    if (!referenced.has(photoId)) console.warn(`${id}: photo ${photoId} is not used by any table in venue.json`);
    // Upright from EXIF, metadata stripped (no location or camera data is published).
    const input = await sharp(await readFile(path.join(src, name)))
      .rotate()
      .toBuffer();
    for (const width of [640, SEAT_VIEW_SIZE.width]) {
      const height = width === SEAT_VIEW_SIZE.width ? SEAT_VIEW_SIZE.height : Math.round(width / SEAT_VIEW_ASPECT);
      const img = sharp(input).resize(width, height, { fit: "cover", position: "attention", kernel: "lanczos3" });
      const avif = await img.clone().avif({ quality: 55, effort: 6 }).toBuffer();
      const webp = await img.clone().webp({ quality: 80, effort: 6 }).toBuffer();
      if (width === 640 && Math.max(avif.length, webp.length) > PHOTO_BUDGET_640) {
        throw new Error(`${id}/${photoId}: 640 px image over the 250 KB budget`);
      }
      await writeFile(path.join(out, `${photoId}-${width}.avif`), avif);
      await writeFile(path.join(out, `${photoId}-${width}.webp`), webp);
    }
    const email = await sharp(input)
      .resize(600, 400, { fit: "cover", position: "attention" })
      .jpeg({ quality: 82, mozjpeg: true })
      .toBuffer();
    await writeFile(path.join(out, `${photoId}-email.jpg`), email);
    count++;
  }
  return count;
}

async function model(id: string): Promise<number | null> {
  const src = path.join("venues", id, "model.glb");
  if (!(await exists(src))) return null;
  const { size } = await stat(src);
  if (size > MODEL_BUDGET) throw new Error(`${id}: model.glb is ${size} bytes, over the 3 MB budget`);
  const out = path.join("public", "venues", id);
  await mkdir(out, { recursive: true });
  await copyFile(src, path.join(out, "model.glb"));
  return size;
}

/** GLTFExporter writes binary output through FileReader, which Node does not have. */
class NodeFileReader {
  result: ArrayBuffer | string | null = null;
  onloadend: (() => void) | null = null;
  readAsArrayBuffer(blob: Blob) {
    void this.load(blob, (buf) => buf);
  }
  readAsDataURL(blob: Blob) {
    void this.load(blob, (buf) => `data:application/octet-stream;base64,${Buffer.from(buf).toString("base64")}`);
  }
  private async load(blob: Blob, as: (buf: ArrayBuffer) => ArrayBuffer | string) {
    this.result = as(await blob.arrayBuffer());
    this.onloadend?.();
  }
}

async function exportDevShell(id: string): Promise<string> {
  const venue = await loadVenue(id);
  const shell = buildShell(venue, LIGHT, venue.brand.accent);
  const scene = new THREE.Scene();
  const clay = new THREE.Mesh(shell.clay, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 }));
  clay.name = "shell";
  const glass = new THREE.Mesh(
    shell.glass,
    new THREE.MeshStandardMaterial({ color: LIGHT.glass, transparent: true, opacity: LIGHT.glassOpacity }),
  );
  glass.name = "glass-shell";
  scene.add(clay, glass);
  (globalThis as unknown as { FileReader: typeof NodeFileReader }).FileReader = NodeFileReader;
  const data = (await new GLTFExporter().parseAsync(scene, { binary: true })) as ArrayBuffer;
  await mkdir(DEV_SHELL_DIR, { recursive: true });
  const file = path.join(DEV_SHELL_DIR, `${id}.glb`);
  await writeFile(file, Buffer.from(data));
  return file;
}

async function main() {
  const args = process.argv.slice(2);
  const devShell = args.includes("--export-dev-shell");
  const venueArg = args.find((a) => !a.startsWith("--"));
  const ids = venueArg ? [venueArg] : await listVenueIds();
  for (const id of ids) {
    if (devShell) {
      const file = await exportDevShell(id);
      const { size } = await stat(file);
      console.log(JSON.stringify({ event: "venue.devShell", venue: id, file, bytes: size }));
      continue;
    }
    const venue = await loadVenue(id);
    const referenced = new Set(venue.tables.map((t) => t.photoId).filter((p): p is string => p !== null));
    const count = await photos(id, referenced);
    const bytes = await model(id);
    for (const p of referenced) {
      if (!(await exists(path.join("public", "venues", id, "photos", `${p}-1280.webp`)))) {
        throw new Error(`${id}: a table uses photo ${p}, but venues/${id}/photos/ has no such file`);
      }
    }
    console.log(JSON.stringify({ event: "venue.assets", venue: id, photos: count, modelBytes: bytes }));
  }
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
