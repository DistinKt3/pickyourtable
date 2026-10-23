import "server-only";
import { existsSync } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { type Venue, venueSchema } from "./schema";

/**
 * Reads venue folders from `venues/<id>/venue.json`. Adding a folder adds a venue;
 * no code changes (PRD D-1). Media lives under `public/venues/<id>/`.
 */

const VENUE_ID = /^[a-z0-9][a-z0-9-]{0,39}$/;
export const VENUES_DIR = path.join(process.cwd(), "venues");
const PUBLIC_VENUES_DIR = path.join(process.cwd(), "public", "venues");

const cache = new Map<string, { mtimeMs: number; venue: Venue }>();

export class VenueNotFoundError extends Error {
  constructor(id: string) {
    super(`venue ${id} not found`);
  }
}

export function isVenueId(id: string): boolean {
  return VENUE_ID.test(id);
}

export async function listVenueIds(): Promise<string[]> {
  const entries = await readdir(VENUES_DIR, { withFileTypes: true });
  const ids: string[] = [];
  for (const e of entries) {
    if (e.isDirectory() && isVenueId(e.name) && existsSync(path.join(VENUES_DIR, e.name, "venue.json"))) {
      ids.push(e.name);
    }
  }
  return ids.sort();
}

export async function loadVenue(id: string): Promise<Venue> {
  if (!isVenueId(id)) throw new VenueNotFoundError(id);
  const file = path.join(VENUES_DIR, id, "venue.json");
  let mtimeMs: number;
  try {
    mtimeMs = (await stat(file)).mtimeMs;
  } catch {
    throw new VenueNotFoundError(id);
  }
  const hit = cache.get(id);
  if (hit && hit.mtimeMs === mtimeMs) return hit.venue;
  const venue = parseVenue(await readFile(file, "utf8"), file);
  if (venue.id !== id) throw new Error(`${file}: id "${venue.id}" does not match its folder "${id}"`);
  cache.set(id, { mtimeMs, venue });
  return venue;
}

export function parseVenue(json: string, source = "venue.json"): Venue {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch (e) {
    throw new Error(`${source}: invalid JSON (${e instanceof Error ? e.message : String(e)})`, { cause: e });
  }
  const result = venueSchema.safeParse(data);
  if (!result.success) {
    const lines = result.error.issues.map((i) => `  ${i.path.join(".") || "(root)"}: ${i.message}`);
    throw new Error(`${source} failed validation:\n${lines.join("\n")}`);
  }
  return result.data;
}

/** The optional venue model (PRD D-2): used when `public/venues/<id>/model.glb` exists. */
export function venueModelUrl(id: string): string | null {
  return existsSync(path.join(PUBLIC_VENUES_DIR, id, "model.glb")) ? `/venues/${id}/model.glb` : null;
}
