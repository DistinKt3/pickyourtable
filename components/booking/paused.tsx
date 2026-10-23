import type { Venue } from "@/lib/venue/schema";

/**
 * Shown instead of the widget when the kill switch is off (PRD S-5) or the venue is
 * not live yet (PRD O-6). The guest always has another way to book.
 */
export function WidgetPaused({ venue, reason }: { venue: Venue; reason: "paused" | "not_live" }) {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-surface-0 px-6 py-16">
      <div className="w-full max-w-md text-center">
        <p className="font-display text-display-l">{venue.name}</p>
        <h1 className="mt-6 text-xl font-semibold">
          {reason === "paused" ? "Online table selection is paused right now" : "Online table booking isn't open yet"}
        </h1>
        <p className="mt-3 text-ink-2">
          To reserve, call{" "}
          <a
            className="font-medium text-ink underline decoration-line-strong underline-offset-4"
            href={`tel:${venue.contact.phone.replace(/[^\d+]/g, "")}`}
          >
            {venue.contact.phone}
          </a>{" "}
          or email{" "}
          <a
            className="font-medium text-ink underline decoration-line-strong underline-offset-4"
            href={`mailto:${venue.contact.email}`}
          >
            {venue.contact.email}
          </a>
          .
        </p>
      </div>
    </main>
  );
}
