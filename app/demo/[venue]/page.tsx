import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { formatTime } from "@/lib/format";
import { isVenueId, loadVenue, VenueNotFoundError } from "@/lib/venue/load";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Venue website (demo)" };

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

function dayRange(days: number[]): string {
  const sorted = [...days].sort((a, b) => a - b);
  if (sorted.length === 7) return "Daily";
  const first = DAYS[sorted[0]! - 1]!;
  const last = DAYS[sorted[sorted.length - 1]! - 1]!;
  return sorted.length === 1 ? first : `${first} to ${last}`;
}

/**
 * A stand-in for a venue's own website, to prove the one-line embed (PRD G-12). It
 * loads /embed.js exactly as a venue site would.
 */
export default async function DemoVenueSite({ params }: { params: Promise<{ venue: string }> }) {
  const { venue: id } = await params;
  if (!isVenueId(id)) notFound();
  let v;
  try {
    v = await loadVenue(id);
  } catch (e) {
    if (e instanceof VenueNotFoundError) notFound();
    throw e;
  }
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  return (
    <div className="min-h-dvh bg-[#f3efe7] text-[#22201c] dark:bg-[#141210] dark:text-[#efe9df]">
      <div className="bg-[#22201c] px-4 py-2 text-center text-sm text-white/80">
        Demo of a venue&rsquo;s own website. The button below is added by one script tag.
      </div>
      <main className="mx-auto flex max-w-3xl flex-col items-center px-6 py-24 text-center">
        <p className="text-sm font-medium tracking-[0.2em] uppercase opacity-60">{v.contact.address}</p>
        <h1 className="mt-6 font-display text-[4.5rem] leading-none">{v.name}</h1>
        {v.tagline ? <p className="mt-5 text-xl opacity-75">{v.tagline}</p> : null}
        <div id="reserve" className="mt-12" />
        <script src="/embed.js" data-venue={v.id} data-accent={v.brand.accent} data-target="#reserve" async nonce={nonce} />
        <dl className="mt-16 grid gap-6 text-left sm:grid-cols-2">
          {v.booking.dayparts.map((d) => (
            <div key={d.id}>
              <dt className="font-display text-2xl">{d.name}</dt>
              <dd className="mt-1 opacity-75">
                {dayRange(d.days)}, {formatTime(d.start)} to {formatTime(d.end)}
              </dd>
            </div>
          ))}
        </dl>
        <p className="mt-16 opacity-70">
          {v.contact.phone} · {v.contact.email}
        </p>
      </main>
    </div>
  );
}
