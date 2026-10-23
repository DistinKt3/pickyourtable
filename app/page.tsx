import Link from "next/link";
import { listVenueIds, loadVenue } from "@/lib/venue/load";

export const dynamic = "force-dynamic";

/** Internal index for the prototype. Guests arrive on a venue link, never here. */
export default async function Index() {
  const venues = await Promise.all((await listVenueIds()).map((id) => loadVenue(id)));
  return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col justify-center gap-10 px-6 py-16">
      <header className="flex flex-col gap-2">
        <p className="text-sm font-medium tracking-[0.08em] text-ink-3 uppercase">Prototype</p>
        <h1 className="font-display text-display-xl">Choose your table</h1>
        <p className="text-ink-2">Demo venues for the guest booking flow, and the venue portal.</p>
      </header>
      <nav aria-label="Demo venues" className="flex flex-col gap-3">
        {venues.map((v) => (
          <Link
            key={v.id}
            href={`/v/${v.id}`}
            className="group flex items-center justify-between rounded-card bg-surface-1 px-5 py-4 hairline transition-colors hover:bg-surface-2"
          >
            <span className="flex flex-col">
              <span className="font-display text-2xl">{v.name}</span>
              <span className="text-[0.9375rem] text-ink-3">{v.tagline}</span>
            </span>
            <span aria-hidden className="text-ink-3 transition-transform group-hover:translate-x-0.5">
              &rarr;
            </span>
          </Link>
        ))}
      </nav>
      <nav aria-label="Tools" className="flex flex-wrap gap-x-6 gap-y-2 text-[0.9375rem]">
        <Link className="text-ink-2 underline decoration-line-strong underline-offset-4 hover:text-ink" href="/portal">
          Venue portal
        </Link>
        <Link className="text-ink-2 underline decoration-line-strong underline-offset-4 hover:text-ink" href="/dev/mail">
          Dev inbox
        </Link>
      </nav>
    </main>
  );
}
