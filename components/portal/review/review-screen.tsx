"use client";

import { Check, ImageOff, Rocket } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { type PlanTableView, Plan2D } from "@/components/room/plan2d/plan2d";
import { Button } from "@/components/ui/button";
import { Badge, Banner, Dialog, Segmented } from "@/components/ui/primitives";
import type { ReviewResponse } from "@/lib/api/contracts";
import { cx, formatDate } from "@/lib/format";
import type { RoomTable } from "@/lib/room/types";
import type { Venue } from "@/lib/venue/schema";
import { PortalError, portalFetch } from "@/lib/portal/client";
import { PageHeader, Panel, TableName, TierDot } from "../ui";

/**
 * Venue review (PRD O-6, Owner): every table's position on the plan and its seat
 * view, side by side, each approved by the owner. Go live stays off until every
 * table is approved; the server refuses it too.
 */

type ReviewTable = ReviewResponse["tables"][number];
type Filter = "all" | "waiting" | "approved";

const COMPASS = ["north", "north-east", "east", "south-east", "south", "south-west", "west", "north-west"];
const facing = (deg: number) => COMPASS[Math.round(deg / 45) % 8]!;

export function ReviewScreen({
  venue,
  venueName,
  tables: roomTables,
  initial,
  liveSinceDate,
  today,
  withoutImage,
}: {
  venue: Venue;
  venueName: string;
  tables: RoomTable[];
  initial: ReviewResponse;
  /** The venue-local date it went live, YYYY-MM-DD. */
  liveSinceDate: string | null;
  today: string;
  /** Tables whose seat view has not been rendered or photographed yet. */
  withoutImage: string[];
}) {
  const [tables, setTables] = useState(initial.tables);
  const [live, setLive] = useState(initial.live);
  const [liveSince, setLiveSince] = useState(liveSinceDate);
  const [filter, setFilter] = useState<Filter>("all");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [confirming, setConfirming] = useState(false);
  const [goLiveError, setGoLiveError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const approved = tables.filter((t) => t.approvedAt).length;
  const all = approved === tables.length;
  const shown = tables.filter((t) => (filter === "all" ? true : filter === "approved" ? t.approvedAt : !t.approvedAt));
  const tiers = useMemo(() => new Map(venue.tiers.map((t) => [t.id, t])), [venue]);

  async function setApproved(t: ReviewTable, value: boolean) {
    const before = t.approvedAt;
    setTables((list) => list.map((x) => (x.code === t.code ? { ...x, approvedAt: value ? new Date().toISOString() : null } : x)));
    setErrors(({ [t.code]: _gone, ...rest }) => rest);
    try {
      const res = await portalFetch<{ table: { approvedAt: string | null } }>(`/api/portal/review/tables/${t.code}`, {
        method: "POST",
        body: { approved: value },
      });
      setTables((list) => list.map((x) => (x.code === t.code ? { ...x, approvedAt: res.table.approvedAt } : x)));
    } catch (e) {
      setTables((list) => list.map((x) => (x.code === t.code ? { ...x, approvedAt: before } : x)));
      setErrors((m) => ({ ...m, [t.code]: e instanceof PortalError ? e.message : "That didn't save." }));
    }
  }

  async function goLive() {
    setBusy(true);
    setGoLiveError(null);
    try {
      await portalFetch("/api/portal/review/go-live", { method: "POST" });
      setLive(true);
      setLiveSince(today);
      setConfirming(false);
    } catch (e) {
      setGoLiveError(e instanceof PortalError ? e.message : "The venue didn't go live.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="pb-12">
      <PageHeader
        title="Venue review"
        eyebrow="Owner settings"
        description="Check that each table sits where it does in the room and that its seat view is right, then approve it."
        actions={
          live ? (
            <span
              data-meta
              className="flex min-h-11 items-center gap-2 rounded-full bg-success-surface px-4 text-[0.9375rem] font-semibold text-success"
            >
              <span aria-hidden className="size-2 rounded-full bg-success" />
              Live{liveSince ? ` since ${formatDate(liveSince, { weekday: "short", year: true })}` : ""}
            </span>
          ) : (
            <Button
              size="lg"
              disabled={!all}
              onClick={() => setConfirming(true)}
              icon={<Rocket aria-hidden className="size-4" />}
            >
              Go live
            </Button>
          )
        }
      />

      <div className="px-4 sm:px-6 lg:px-8">
        <Panel className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 px-5 py-4">
          <div className="min-w-[14rem] flex-1">
            <p className="text-base text-ink">
              <span className="text-xl font-semibold tabular">{approved}</span> of{" "}
              <span className="tabular">{tables.length}</span> tables approved
              {!all ? (
                <span className="text-ink-3"> · {live ? "the venue stays live" : "go live unlocks when all are approved"}</span>
              ) : null}
            </p>
            <div aria-hidden className="mt-2.5 h-2 overflow-hidden rounded-full bg-surface-2">
              <div
                className={cx("h-full rounded-full transition-[width] duration-300", all ? "bg-success" : "bg-accent")}
                style={{ width: `${(approved / Math.max(1, tables.length)) * 100}%` }}
              />
            </div>
          </div>
          <Segmented
            label="Show"
            value={filter}
            onChange={setFilter}
            options={[
              { value: "all", label: `All ${tables.length}` },
              { value: "waiting", label: `To review ${tables.length - approved}` },
              { value: "approved", label: `Approved ${approved}` },
            ]}
          />
        </Panel>

        <ul className="mt-5 flex flex-col gap-4">
          {shown.map((t) => (
            <li key={t.code}>
              <TableReview
                t={t}
                available={!withoutImage.includes(t.code)}
                venue={venue}
                roomTables={roomTables}
                tierName={tiers.get(t.tier)?.name ?? t.tier}
                tierColor={tiers.get(t.tier)?.color ?? "#8c857a"}
                error={errors[t.code] ?? null}
                onApprove={(v) => void setApproved(t, v)}
              />
            </li>
          ))}
        </ul>
        {shown.length === 0 ? (
          <p className="mt-8 text-center text-base text-ink-3">
            {filter === "waiting" ? "Every table is approved." : "No tables approved yet."}
          </p>
        ) : null}
      </div>

      {confirming ? (
        <Dialog
          open
          onClose={() => setConfirming(false)}
          title={`Take ${venueName} live?`}
          footer={
            <>
              <Button variant="secondary" onClick={() => setConfirming(false)}>
                Not yet
              </Button>
              <Button loading={busy} onClick={() => void goLive()}>
                Go live
              </Button>
            </>
          }
        >
          <p className="text-base">
            Guests can choose and pay for tables from the venue&rsquo;s link as soon as you do. All {tables.length} tables are
            approved.
          </p>
          {goLiveError ? (
            <Banner tone="danger" className="mt-4">
              {goLiveError}
            </Banner>
          ) : null}
        </Dialog>
      ) : null}
    </div>
  );
}

function TableReview({
  t,
  available,
  venue,
  roomTables,
  tierName,
  tierColor,
  error,
  onApprove,
}: {
  t: ReviewTable;
  /** Whether the seat view image exists, checked on the server. */
  available: boolean;
  venue: Venue;
  roomTables: RoomTable[];
  tierName: string;
  tierColor: string;
  error: string | null;
  onApprove: (approved: boolean) => void;
}) {
  const views = useMemo(() => {
    const out: Record<string, PlanTableView> = {};
    for (const x of roomTables) {
      const me = x.id === t.code;
      out[x.id] = {
        ring: me ? "bold" : "none",
        faded: false,
        muted: !me,
        label: x.label,
        short: x.id,
        detail: null,
        ariaLabel: me ? `${x.label}, the table under review` : x.label,
        priority: me ? 10 : 0,
      };
    }
    return out;
  }, [roomTables, t.code]);

  return (
    <Panel
      aria-label={t.label}
      className={cx("overflow-hidden", t.approvedAt ? "" : "shadow-[inset_0_0_0_1.5px_var(--accent-base)]")}
    >
      <div className="grid grid-cols-1 gap-4 p-4 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(14rem,0.85fr)] lg:items-stretch">
        <figure className="flex flex-col gap-2">
          <div className="relative aspect-[3/2] overflow-hidden rounded-control bg-surface-0 hairline">
            <Plan2D
              venue={venue}
              tables={roomTables}
              views={views}
              selected={t.code}
              ariaLabel={`Where ${t.label} is in the room`}
              className="absolute inset-0"
            />
          </div>
          <figcaption className="text-sm text-ink-3">Position on the plan</figcaption>
        </figure>
        <figure className="flex flex-col gap-2">
          <SeatView t={t} available={available} />
          <figcaption className="text-base text-ink-3">View from the main seat</figcaption>
        </figure>
        <div className="flex flex-col gap-3 sm:col-span-2 lg:col-span-1 lg:pl-2">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="leading-tight text-ink">
                <TableName label={t.label} className="text-[1.625rem]" />
              </p>
              <p className="mt-1 flex items-center gap-2 text-[0.9375rem] text-ink-2">
                <TierDot color={tierColor} />
                {tierName} · {t.seats} seats
              </p>
            </div>
            {t.approvedAt ? <Badge tone="success">Approved</Badge> : <Badge tone="accent">To review</Badge>}
          </div>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[0.9375rem] tabular">
            <dt className="text-ink-3">Position</dt>
            <dd className="text-ink">
              <span className="whitespace-nowrap">x {t.x.toFixed(2)} m</span> ·{" "}
              <span className="whitespace-nowrap">z {t.z.toFixed(2)} m</span>
            </dd>
            <dt className="text-ink-3">Facing</dt>
            <dd className="text-ink">
              {facing(t.rotation)}, {t.rotation}°
            </dd>
            <dt className="text-ink-3">Online</dt>
            <dd className="text-ink">{t.bookable ? "Bookable" : "Seated by the host"}</dd>
          </dl>
          <div className="mt-auto flex flex-wrap items-center gap-2 pt-1">
            {t.approvedAt ? (
              <Button variant="ghost" onClick={() => onApprove(false)} className="-ml-2">
                Unapprove
              </Button>
            ) : (
              <Button
                onClick={() => onApprove(true)}
                icon={<Check aria-hidden className="size-4" strokeWidth={2.25} />}
                aria-label={`Approve ${t.label}`}
              >
                Approve
              </Button>
            )}
          </div>
          {error ? (
            <p role="alert" className="text-base font-medium text-danger">
              {error}
            </p>
          ) : null}
        </div>
      </div>
    </Panel>
  );
}

function SeatView({ t, available }: { t: ReviewTable; available: boolean }) {
  const [failed, setFailed] = useState(false);
  const missing = !available || failed;
  const img = useRef<HTMLImageElement>(null);
  // An image that failed before hydration never fires onError; check once on mount.
  useEffect(() => {
    const el = img.current;
    if (el?.complete && el.naturalWidth === 0) setFailed(true);
  }, []);
  const kind = t.image.kind === "photo" ? "Photo" : "Preview render";
  return (
    <div className="relative aspect-[3/2] overflow-hidden rounded-control bg-surface-2 hairline">
      {missing ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-6 text-center">
          <ImageOff aria-hidden className="size-6 text-ink-3" strokeWidth={1.5} />
          <p className="text-base font-medium text-ink-2">No seat view yet</p>
          <p className="text-base text-ink-3">
            {t.bookable ? "Its render or photo hasn't been made." : "Host-seated tables have no seat view."}
          </p>
        </div>
      ) : (
        <>
          <picture>
            <source type="image/avif" srcSet={t.image.avif} sizes="(min-width: 1280px) 30vw, 45vw" />
            <source type="image/webp" srcSet={t.image.webp} sizes="(min-width: 1280px) 30vw, 45vw" />
            <img
              ref={img}
              src={t.image.fallback}
              alt={`The view from ${t.label}`}
              loading="lazy"
              decoding="async"
              onError={() => setFailed(true)}
              className="absolute inset-0 size-full object-cover"
            />
          </picture>
          <span className="absolute top-2 left-2 inline-flex h-7 items-center rounded-full bg-black/55 px-2.5 text-sm font-medium text-white backdrop-blur-sm">
            {kind}
          </span>
        </>
      )}
    </div>
  );
}
