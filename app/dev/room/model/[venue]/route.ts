import { readFile } from "node:fs/promises";
import path from "node:path";
import { venueParams } from "@/lib/api/contracts";
import { api, ApiError } from "@/lib/http/api";

/**
 * Development only: serves the room shell exported by
 * `scripts/venue-assets.ts --export-dev-shell` (artifacts/tmp, never shipped), so the
 * review page can prove the venue-model path with `?model=dev`.
 */
export const GET = api({ params: venueParams }, async ({ params }) => {
  if (process.env.NODE_ENV === "production") throw new ApiError(404, "not_found", "Not found.");
  let data: Buffer;
  try {
    data = await readFile(path.join(process.cwd(), "artifacts", "tmp", "dev-shell", `${params.venue}.glb`));
  } catch {
    throw new ApiError(404, "not_found", "No exported shell. Run scripts/venue-assets.ts --export-dev-shell first.");
  }
  return new Response(new Uint8Array(data), { headers: { "content-type": "model/gltf-binary" } });
});
