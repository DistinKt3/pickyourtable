import { headers } from "next/headers";
import { formatTime } from "@/lib/format";
import { isVenueId, loadVenue, VenueNotFoundError } from "@/lib/venue/load";

export const dynamic = "force-dynamic";

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

function dayRange(days: number[]): string {
  const sorted = [...days].sort((a, b) => a - b);
  if (sorted.length === 7) return "Daily";
  const first = DAYS[sorted[0]! - 1]!;
  const last = DAYS[sorted[sorted.length - 1]! - 1]!;
  return sorted.length === 1 ? first : `${first} to ${last}`;
}

const ENTITIES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ENTITIES[c]!);

const notFound = () => new Response("Not found", { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } });

/**
 * A stand-in for a venue's own website, to prove the one-line embed (PRD G-12). It is
 * plain HTML, not a React page, because that is what a venue's site is: embed.js adds
 * its button to a page nobody re-renders. It loads /embed.js exactly as a venue site
 * would, with this request's CSP nonce.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ venue: string }> }): Promise<Response> {
  const { venue: id } = await params;
  if (!isVenueId(id)) return notFound();
  let v;
  try {
    v = await loadVenue(id);
  } catch (e) {
    if (e instanceof VenueNotFoundError) return notFound();
    throw e;
  }
  const nonce = (await headers()).get("x-nonce") ?? "";
  const hours = v.booking.dayparts
    .map(
      (d) =>
        `<div><dt>${esc(d.name)}</dt><dd>${esc(dayRange(d.days))}, ${esc(formatTime(d.start))} to ${esc(formatTime(d.end))}</dd></div>`,
    )
    .join("");
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(v.name)} (demo venue website)</title>
<style>
  :root { color-scheme: light dark; --bg: #f3efe7; --ink: #22201c; --soft: #625b51; }
  @media (prefers-color-scheme: dark) { :root { --bg: #141210; --ink: #efe9df; --soft: #b0a798; } }
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100dvh; background: var(--bg); color: var(--ink); font: 17px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
  .note { background: #22201c; color: #e8e2d8; padding: 8px 16px; text-align: center; font-size: 16px; }
  main { max-width: 48rem; margin: 0 auto; padding: 96px 24px; text-align: center; }
  .address { margin: 0; font-size: 14px; font-weight: 500; letter-spacing: 0.2em; text-transform: uppercase; color: var(--soft); }
  h1 { margin: 24px 0 0; font: 400 clamp(3rem, 12vw, 4.5rem)/1 Georgia, "Times New Roman", serif; }
  .tagline { margin: 20px 0 0; font-size: 20px; color: var(--soft); }
  #reserve { margin-top: 48px; }
  dl { display: grid; gap: 24px; margin: 64px 0 0; text-align: left; }
  @media (min-width: 640px) { dl { grid-template-columns: 1fr 1fr; } }
  dt { font: 24px/1.2 Georgia, serif; }
  dd { margin: 4px 0 0; color: var(--soft); }
  .contact { margin-top: 64px; color: var(--soft); }
</style>
</head>
<body>
<div class="note">Demo of a venue&rsquo;s own website. The button below is added by one script tag.</div>
<main>
  <p class="address">${esc(v.contact.address)}</p>
  <h1>${esc(v.name)}</h1>
  ${v.tagline ? `<p class="tagline">${esc(v.tagline)}</p>` : ""}
  <div id="reserve"></div>
  <script src="/embed.js" data-venue="${esc(v.id)}" data-accent="${esc(v.brand.accent)}" data-target="#reserve" async nonce="${esc(nonce)}"></script>
  <dl>${hours}</dl>
  <p class="contact">${esc(v.contact.phone)} &middot; ${esc(v.contact.email)}</p>
</main>
</body>
</html>`;
  return new Response(html, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
}
