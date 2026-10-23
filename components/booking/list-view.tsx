"use client";

import { ChevronRight } from "lucide-react";
import { priceText, stateText } from "@/components/room/views";
import { cx } from "@/lib/format";
import { type RoomData, visualState } from "@/lib/room/types";
import { useRoom } from "@/lib/room/store";
import { SeatViewImage, TierDot } from "./parts";

/**
 * Every table as a list, grouped by tier: the same choices as the room, and the full
 * flow without WebGL or with a screen reader (PRD G-10).
 */
export function ListView({ data }: { data: RoomData }) {
  const availability = useRoom((s) => s.availability);
  const selected = useRoom((s) => s.selected);
  const select = useRoom((s) => s.select);
  const hasSlot = availability !== null;
  const { venue } = data;
  const bookableTiers = venue.tiers.filter((t) => data.tables.some((x) => x.tier === t.id && x.bookable));
  const others = data.tables.filter((t) => !t.bookable);

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-2xl px-4 pt-4 pb-32 lg:px-6 lg:pt-6">
        {bookableTiers.map((tier) => {
          const tables = data.tables.filter((t) => t.tier === tier.id && t.bookable);
          const free = tables.filter((t) => visualState(t, availability?.[t.id]) === "available").length;
          return (
            <section key={tier.id} aria-labelledby={`tier-${tier.id}`} className="mb-8">
              <header className="mb-3 flex items-baseline justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <TierDot color={tier.color} colorDark={tier.colorDark} />
                  <h2 id={`tier-${tier.id}`} className="font-display text-[1.625rem] leading-tight">
                    {tier.name}
                  </h2>
                </div>
                {hasSlot ? (
                  <p className="text-[0.9375rem] text-ink-3 tabular">
                    {free === 0 ? "None free" : `${free} of ${tables.length} free`}
                  </p>
                ) : null}
              </header>
              <p className="-mt-1 mb-3 text-base text-ink-2">{tier.description}</p>
              <ul className="flex flex-col gap-2">
                {tables.map((t) => {
                  const a = availability?.[t.id];
                  const s = visualState(t, a);
                  const inactive = s !== "available";
                  const price = priceText(t, a, hasSlot);
                  return (
                    <li key={t.id}>
                      <button
                        type="button"
                        onClick={() => select(t.id)}
                        aria-pressed={selected === t.id}
                        className={cx(
                          "group flex w-full items-center gap-3 rounded-card bg-surface-1 p-2 pr-3 text-left hairline transition-colors duration-150 hover:bg-surface-2",
                          selected === t.id && "shadow-[inset_0_0_0_2px_var(--accent-base)]",
                        )}
                      >
                        <div className={cx("w-28 shrink-0 overflow-hidden rounded-[12px]", inactive && "opacity-55 grayscale")}>
                          {t.image ? <SeatViewImage image={t.image} alt="" sizes="112px" showTag={false} /> : null}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className={cx("font-display text-[1.375rem] leading-tight", inactive && "text-ink-3")}>
                            {t.label}
                            <span className="sr-only">, {tier.name}</span>
                          </p>
                          <p data-meta className="truncate text-[0.9375rem] text-ink-3">
                            {t.seats} seats{t.attributes.length ? ` · ${t.attributes.join(", ")}` : ""}
                          </p>
                        </div>
                        <div className="shrink-0 text-right">
                          {s === "available" ? (
                            <p className="font-semibold tabular">
                              <span className="sr-only">{hasSlot ? "Available, " : "Bookable, "}</span>
                              {price}
                            </p>
                          ) : (
                            <p className="text-[0.9375rem] text-ink-3">{stateText(t, a)}</p>
                          )}
                        </div>
                        <ChevronRight aria-hidden className="size-4 shrink-0 text-ink-3" />
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
        {others.length ? (
          <section aria-labelledby="tier-others" className="rounded-card bg-surface-2 px-4 py-4">
            <h2 id="tier-others" className="font-medium">
              Other tables
            </h2>
            <p className="mt-1 text-base text-ink-2">
              {others.length} main-floor tables are seated by the host on arrival and can&rsquo;t be reserved online.
            </p>
          </section>
        ) : null}
      </div>
    </div>
  );
}
