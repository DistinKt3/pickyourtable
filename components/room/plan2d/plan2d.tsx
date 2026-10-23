"use client";

import { type CSSProperties, type KeyboardEvent, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { cx } from "@/lib/format";
import { planOrientation } from "@/lib/room/orientation";
import type { Ring } from "@/lib/venue/geometry";
import type { Venue, VenueTable } from "@/lib/venue/schema";
import {
  areaLabelPoint,
  type PlanFrame,
  planFrame,
  polygonPath,
  project,
  type TableShape,
  tableShape,
  wallShapes,
  waterShape,
} from "./layout";

/**
 * The 2D plan: an SVG drawn from venue.json in meters. It paints before any
 * JavaScript runs (server-rendered), works without WebGL, and is reused by the
 * operator portal. Both orientations are rendered and a container query shows the
 * one that fits (see lib/room/orientation.ts), so the first paint is right before
 * hydration. Labels are HTML overlays with a collision pass, so text stays crisp and
 * never overlaps.
 */

export type RingStyle = "solid" | "bold" | "hatched" | "dashed" | "none";

export interface PlanTableView {
  ring: RingStyle;
  /** About 40% opacity and desaturated (taken). */
  faded: boolean;
  /** Desaturated at full opacity (wrong size, not bookable). */
  muted: boolean;
  /** Full label, such as "Window 1". */
  label: string;
  /** Compact label, such as "W1". */
  short: string;
  /** Price or state text shown after the label, such as "$40" or "Taken". */
  detail: string | null;
  /** Compact detail, shown when space is tight, such as "$40". */
  shortDetail?: string | null;
  /** A second line, used by the portal ("7:30 pm, Reyes"). */
  badge?: string | null;
  badgeTone?: "accent" | "success" | "warning" | "neutral";
  ariaLabel: string;
  /** Higher wins the label collision pass. */
  priority: number;
}

export interface Plan2DProps {
  venue: Venue;
  tables: VenueTable[];
  views: Record<string, PlanTableView>;
  ariaLabel: string;
  selected?: string | null;
  hovered?: string | null;
  onSelect?: (code: string) => void;
  onHover?: (code: string | null) => void;
  /** Keeps the selected table in view above a bottom sheet of this height, in px. */
  focus?: { code: string; bottomInset: number } | null;
  reducedMotion?: boolean;
  className?: string;
  /**
   * How labels share space. "full-first" (default) gives each label, highest priority
   * first, its full form when it fits. "compact-first" labels as many tables as possible
   * in their compact form, then upgrades the ones with room (the portal's Tonight plan,
   * where every paid table must show).
   */
  labelFit?: "full-first" | "compact-first";
}

export function Plan2D(props: Plan2DProps) {
  const { venue } = props;
  const frames = useMemo(
    () => ({ landscape: planFrame(venue, planOrientation(venue, 1.6)), portrait: planFrame(venue, planOrientation(venue, 0.5)) }),
    [venue],
  );
  return (
    <div className={cx("plan-root relative size-full overflow-hidden", props.className)}>
      <PlanBox {...props} frame={frames.landscape} variant="landscape" />
      <PlanBox {...props} frame={frames.portrait} variant="portrait" />
    </div>
  );
}

type LabelMode = "full" | "compact" | "hidden";

function PlanBox({
  venue,
  tables,
  views,
  ariaLabel,
  selected,
  hovered,
  onSelect,
  onHover,
  focus,
  reducedMotion,
  labelFit,
  frame,
  variant,
}: Plan2DProps & { frame: PlanFrame; variant: "landscape" | "portrait" }) {
  const uid = useId().replace(/:/g, "");
  const boxRef = useRef<HTMLDivElement>(null);
  const outerRef = useRef<HTMLElement>(null);
  const [box, setBox] = useState<{ w: number; h: number; ow: number; oh: number } | null>(null);
  const shapes = useMemo(() => tables.map((t) => ({ table: t, shape: tableShape(t) })), [tables]);
  const walls = useMemo(() => wallShapes(venue), [venue]);
  const water = useMemo(() => waterShape(venue), [venue]);
  const tiers = useMemo(() => new Map(venue.tiers.map((t) => [t.id, t])), [venue]);
  const namedAreas = useMemo(
    () =>
      venue.areas
        .filter((a) => a.name && a.kind !== "dining" && a.kind !== "promenade")
        .map((a) => ({ id: a.id, name: a.name!, at: project(frame, areaLabelPoint(venue, a)) })),
    [venue, frame],
  );

  // Measure this orientation's box (zero while the other orientation is showing).
  useLayoutEffect(() => {
    const el = boxRef.current;
    const outer = outerRef.current;
    if (!el || !outer) return;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      const o = outer.getBoundingClientRect();
      setBox(r.width > 0 ? { w: r.width, h: r.height, ow: o.width, oh: o.height } : null);
    });
    ro.observe(el);
    ro.observe(outer);
    return () => ro.disconnect();
  }, []);

  const modes = useLabelModes(boxRef, box, tables, views, selected ?? null, hovered ?? null, frame, labelFit ?? "full-first");

  // Keep the focused table visible above the sheet: scale up slightly and pan.
  const transform = useMemo(() => {
    if (!focus || !box) return "none";
    const t = tables.find((x) => x.id === focus.code);
    if (!t) return "none";
    const visibleH = Math.max(160, box.oh - focus.bottomInset);
    const zoom = Math.min(1.8, Math.max(1.15, (box.oh / visibleH) * 1.05));
    const p = project(frame, { x: t.x, z: t.z });
    const px = (p.left / 100) * box.w;
    const py = (p.top / 100) * box.h;
    const boxLeft = (box.ow - box.w) / 2;
    const boxTop = (box.oh - box.h) / 2;
    const targetX = box.ow / 2;
    const targetY = visibleH / 2;
    const tx = targetX - (boxLeft + px * zoom);
    const ty = targetY - (boxTop + py * zoom);
    return `translate(${tx.toFixed(1)}px, ${ty.toFixed(1)}px) scale(${zoom.toFixed(3)})`;
  }, [focus, box, tables, frame]);

  const anySelected = Boolean(selected);

  return (
    <section
      ref={outerRef}
      aria-label={ariaLabel}
      className={cx("absolute inset-0 items-center justify-center", variant === "portrait" ? "plan-portrait" : "plan-landscape")}
    >
      <div
        ref={boxRef}
        className="relative origin-top-left transition-transform duration-500 ease-in-out-soft motion-reduce:transition-none"
        style={{
          aspectRatio: `${frame.viewBox.w} / ${frame.viewBox.h}`,
          width: `min(100cqw, calc(100cqh * ${frame.aspect.toFixed(4)}))`,
          transform: focus && transform !== "none" ? transform : undefined,
          transitionDuration: reducedMotion ? "0ms" : undefined,
        }}
        data-plan={variant}
        data-bearing={frame.bearing}
      >
        <svg
          viewBox={`${frame.viewBox.x} ${frame.viewBox.y} ${frame.viewBox.w} ${frame.viewBox.h}`}
          className="absolute inset-0 size-full overflow-visible"
        >
          <defs>
            <pattern id={`deck-${uid}`} width="0.16" height="0.16" patternUnits="userSpaceOnUse">
              <line x1="0" y1="0.08" x2="0.16" y2="0.08" stroke="var(--plan-furniture-line)" strokeWidth="0.012" opacity="0.35" />
            </pattern>
            <pattern id={`hatch-${uid}`} width="0.12" height="0.12" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <line x1="0" y1="0" x2="0" y2="0.12" stroke="var(--line-strong)" strokeWidth="0.03" />
            </pattern>
            <radialGradient id={`glow-${uid}`}>
              <stop offset="0" stopColor="var(--accent-base)" stopOpacity="0.22" />
              <stop offset="1" stopColor="var(--accent-base)" stopOpacity="0" />
            </radialGradient>
          </defs>
          <g transform={`rotate(${frame.rotate})`}>
            {water ? (
              <g aria-hidden>
                <path d={water.path} fill="var(--plan-water)" />
                {water.waves.map((w) => (
                  <line
                    key={`${w.x1},${w.z1}`}
                    {...{ x1: w.x1, y1: w.z1, x2: w.x2, y2: w.z2 }}
                    stroke="var(--plan-glass)"
                    strokeWidth="0.035"
                    strokeLinecap="round"
                    opacity="0.45"
                  />
                ))}
              </g>
            ) : null}
            <g aria-hidden>
              {venue.areas.map((a) => (
                <path
                  key={a.id}
                  d={polygonPath(a.polygon)}
                  fill={areaFill(a.kind)}
                  stroke={a.kind === "promenade" || a.kind === "garden" ? "none" : "var(--line)"}
                  strokeWidth="0.03"
                />
              ))}
              {venue.areas
                .filter((a) => a.kind === "terrace")
                .map((a) => (
                  <path key={`${a.id}-deck`} d={polygonPath(a.polygon)} fill={`url(#deck-${uid})`} />
                ))}
              {venue.fixtures.map((x) => (
                <Fixture key={x.id} fixture={x} />
              ))}
              {walls.map((w) => (
                <WallLine key={w.id} wall={w} />
              ))}
            </g>
            {shapes.map(({ table, shape }) => {
              const view = views[table.id];
              if (!view) return null;
              const tier = tiers.get(table.tier);
              return (
                <TableGlyph
                  key={table.id}
                  shape={shape}
                  view={view}
                  tierColor={tier?.color ?? "#8c857a"}
                  tierColorDark={tier?.colorDark ?? "#a49d92"}
                  selected={selected === table.id}
                  hovered={hovered === table.id}
                  dimmed={anySelected && selected !== table.id}
                  hatchId={`hatch-${uid}`}
                  glowId={`glow-${uid}`}
                  onSelect={onSelect}
                  onHover={onHover}
                />
              );
            })}
          </g>
        </svg>

        <div aria-hidden className="pointer-events-none absolute inset-0">
          {namedAreas.map((a) => (
            <span
              key={a.id}
              className="absolute -translate-x-1/2 -translate-y-1/2 text-[0.6875rem] font-medium tracking-[0.12em] whitespace-nowrap text-ink-3 uppercase"
              style={{ left: `${a.at.left}%`, top: `${a.at.top}%` }}
            >
              {a.name}
            </span>
          ))}
          {tables.map((t) => {
            const view = views[t.id];
            if (!view) return null;
            const at = project(frame, { x: t.x, z: t.z });
            return (
              <PlanLabel
                key={t.id}
                code={t.id}
                view={view}
                at={at}
                mode={modes[t.id] ?? (view.priority >= 2 ? "compact" : "hidden")}
                selected={selected === t.id}
              />
            );
          })}
        </div>
        <Compass bearing={frame.bearing} />
      </div>
    </section>
  );
}

function areaFill(kind: string): string {
  switch (kind) {
    case "terrace":
      return "var(--plan-floor-outdoor)";
    case "kitchen":
      return "var(--surface-3)";
    case "promenade":
      return "var(--surface-2)";
    case "garden":
      return "color-mix(in oklab, var(--plan-floor-outdoor) 70%, #7f9a6a 30%)";
    case "service":
      return "var(--surface-2)";
    default:
      return "var(--plan-floor)";
  }
}

function Fixture({ fixture: x }: { fixture: Venue["fixtures"][number] }) {
  const transform = `translate(${x.x} ${x.z}) rotate(${x.rotation})`;
  if (x.kind === "railing") {
    return (
      <rect
        transform={transform}
        x={-x.width / 2}
        y={-x.depth / 2}
        width={x.width}
        height={x.depth}
        rx={Math.min(x.width, x.depth) / 2}
        fill="var(--plan-glass)"
        opacity="0.8"
      />
    );
  }
  const fill =
    x.kind === "planter"
      ? "color-mix(in oklab, var(--plan-furniture) 60%, #7f9a6a 40%)"
      : x.kind === "back-of-house"
        ? "var(--surface-3)"
        : "var(--plan-furniture)";
  return (
    <rect
      transform={transform}
      x={-x.width / 2}
      y={-x.depth / 2}
      width={x.width}
      height={x.depth}
      rx={x.kind === "back-of-house" ? 0.04 : 0.08}
      fill={fill}
      stroke="var(--plan-furniture-line)"
      strokeWidth="0.025"
    />
  );
}

function WallLine({ wall: w }: { wall: ReturnType<typeof wallShapes>[number] }) {
  const line = { x1: w.x1, y1: w.z1, x2: w.x2, y2: w.z2 };
  if (w.kind === "solid") {
    return <line {...line} stroke="var(--plan-wall)" strokeWidth="0.2" strokeLinecap="square" />;
  }
  if (w.kind === "doorway") {
    return (
      <g>
        {w.ticks.map((t) => (
          <line key={`${t.x1},${t.z1}`} x1={t.x1} y1={t.z1} x2={t.x2} y2={t.z2} stroke="var(--plan-wall)" strokeWidth="0.06" />
        ))}
      </g>
    );
  }
  return (
    <g>
      <line {...line} stroke="var(--plan-glass)" strokeWidth="0.2" opacity="0.28" />
      <line {...line} stroke="var(--plan-glass)" strokeWidth="0.045" />
      {w.ticks.map((t) => (
        <line
          key={`${t.x1},${t.z1}`}
          x1={t.x1}
          y1={t.z1}
          x2={t.x2}
          y2={t.z2}
          stroke="var(--plan-glass)"
          strokeWidth={w.kind === "glass" ? 0.04 : 0.06}
        />
      ))}
    </g>
  );
}

function RingShape({
  ring,
  className,
  style,
  fill,
  strokeWidth,
  dash,
}: {
  ring: Ring;
  className?: string;
  style?: CSSProperties;
  fill?: string;
  strokeWidth: number;
  dash?: string;
}) {
  const common = { className, style, fill: fill ?? "none", strokeWidth, strokeDasharray: dash };
  if (ring.kind === "circle") return <circle cx={ring.x} cy={ring.z} r={ring.r} {...common} />;
  return (
    <rect
      transform={`translate(${ring.x} ${ring.z}) rotate(${ring.rotation})`}
      x={-ring.width / 2}
      y={-ring.depth / 2}
      width={ring.width}
      height={ring.depth}
      rx={ring.corner}
      {...common}
    />
  );
}

function TableGlyph({
  shape,
  view,
  tierColor,
  tierColorDark,
  selected,
  hovered,
  dimmed,
  hatchId,
  glowId,
  onSelect,
  onHover,
}: {
  shape: TableShape;
  view: PlanTableView;
  tierColor: string;
  tierColorDark: string;
  selected: boolean;
  hovered: boolean;
  dimmed: boolean;
  hatchId: string;
  glowId: string;
  onSelect?: (code: string) => void;
  onHover?: (code: string | null) => void;
}) {
  const vars = { "--tl": tierColor, "--td": tierColorDark } as CSSProperties;
  const ringClass = "stroke-[var(--tl)] dark:stroke-[var(--td)] transition-[stroke-width,opacity] duration-200";
  const furniture = view.faded || view.muted ? "var(--surface-3)" : "var(--plan-furniture)";
  const furnitureLine = view.faded || view.muted ? "var(--line-strong)" : "var(--plan-furniture-line)";
  const r = shape.ring;
  const reach = r.kind === "circle" ? r.r : Math.max(r.width, r.depth) / 2;
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onSelect?.(shape.code);
    }
  };
  const ringWidth = selected ? 0.1 : hovered ? 0.085 : view.ring === "bold" ? 0.08 : 0.05;
  return (
    <g
      role="button"
      tabIndex={onSelect ? 0 : -1}
      aria-label={view.ariaLabel}
      aria-pressed={selected}
      data-code={shape.code}
      className="group cursor-pointer outline-none"
      style={{ ...vars, opacity: dimmed ? 0.62 : 1, transition: "opacity 200ms var(--ease-out-soft)" }}
      onClick={() => onSelect?.(shape.code)}
      onKeyDown={onKey}
      onPointerEnter={() => onHover?.(shape.code)}
      onPointerLeave={() => onHover?.(null)}
      onFocus={() => onHover?.(shape.code)}
      onBlur={() => onHover?.(null)}
    >
      {selected ? <circle cx={shape.ring.x} cy={shape.ring.z} r={reach * 1.7} fill={`url(#${glowId})`} /> : null}
      {view.ring !== "none" ? (
        <RingShape
          ring={r}
          className={cx(ringClass, "fill-[var(--tl)] dark:fill-[var(--td)]")}
          style={{ fillOpacity: selected ? 0.16 : hovered ? 0.12 : view.ring === "bold" ? 0.12 : 0.06 }}
          strokeWidth={ringWidth}
          dash={view.ring === "hatched" ? "0.05 0.07" : view.ring === "dashed" ? "0.16 0.1" : undefined}
        />
      ) : null}
      {view.ring === "hatched" ? <RingShape ring={r} fill={`url(#${hatchId})`} strokeWidth={0} style={{ opacity: 0.5 }} /> : null}
      <g opacity={view.faded ? 0.4 : 1}>
        {shape.chairs.map((c) => (
          <g key={c.transform} transform={c.transform}>
            <rect
              x={-0.21}
              y={-0.2}
              width={0.42}
              height={0.4}
              rx={0.09}
              fill={furniture}
              stroke={furnitureLine}
              strokeWidth={0.02}
            />
            <rect x={-0.19} y={0.12} width={0.38} height={0.09} rx={0.045} fill={furnitureLine} opacity={0.55} />
          </g>
        ))}
        <g transform={shape.transform}>
          {shape.booth ? (
            <>
              <path d={shape.booth.bench} fill={furniture} stroke={furnitureLine} strokeWidth={0.02} />
              <path d={shape.booth.back} fill={furnitureLine} opacity={0.5} />
            </>
          ) : null}
          {shape.top.kind === "circle" ? (
            <circle r={shape.top.r} fill={furniture} stroke={furnitureLine} strokeWidth={0.025} />
          ) : (
            <rect
              x={-shape.top.w / 2}
              y={-shape.top.d / 2}
              width={shape.top.w}
              height={shape.top.d}
              rx={shape.top.r}
              fill={furniture}
              stroke={furnitureLine}
              strokeWidth={0.025}
            />
          )}
        </g>
      </g>
      {/* Tap target and focus ring */}
      <circle cx={r.x} cy={r.z} r={shape.hit} fill="transparent" />
      <circle
        cx={r.x}
        cy={r.z}
        r={shape.hit + 0.06}
        fill="none"
        stroke="var(--accent-base)"
        strokeWidth={0.07}
        className="opacity-0 transition-opacity duration-150 group-focus-visible:opacity-100"
      />
    </g>
  );
}

function PlanLabel({
  code,
  view,
  at,
  mode,
  selected,
}: {
  code: string;
  view: PlanTableView;
  at: { left: number; top: number };
  mode: LabelMode;
  selected: boolean;
}) {
  const inactive = view.faded || view.muted;
  return (
    <span
      data-label={code}
      data-mode={mode}
      className={cx(
        "absolute flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-0.5 transition-opacity duration-200",
        mode === "hidden" ? "opacity-0" : "opacity-100",
      )}
      style={{ left: `${at.left}%`, top: `${at.top}%`, zIndex: selected ? 3 : view.priority }}
    >
      <span
        className={cx(
          "inline-flex h-6 items-center gap-1 rounded-full px-2 text-[0.8125rem] leading-none font-medium whitespace-nowrap tabular shadow-chip",
          selected ? "bg-ink text-surface-1" : inactive ? "bg-surface-1/90 text-ink-3" : "bg-surface-1 text-ink",
        )}
      >
        <span data-variant="full" className={mode === "full" ? "contents" : "hidden"}>
          <span>{view.label}</span>
          {view.detail ? <span className={selected ? "opacity-75" : "text-ink-3"}>{view.detail}</span> : null}
        </span>
        <span data-variant="compact" className={mode === "full" ? "hidden" : "contents"}>
          <span>{view.shortDetail ?? view.short}</span>
        </span>
      </span>
      {view.badge ? (
        <span
          data-badge
          className={cx(
            "inline-flex h-5 items-center rounded-full px-1.5 text-[0.6875rem] leading-none font-semibold whitespace-nowrap tabular",
            view.badgeTone === "success"
              ? "bg-success-surface text-success"
              : view.badgeTone === "warning"
                ? "bg-warning-surface text-warning"
                : view.badgeTone === "accent"
                  ? "bg-accent text-on-accent"
                  : "bg-surface-2 text-ink-2",
          )}
        >
          {view.badge}
        </span>
      ) : null}
    </span>
  );
}

function Compass({ bearing }: { bearing: number }) {
  // Screen-up is `bearing`, so north points at -bearing on screen.
  const a = (-bearing * Math.PI) / 180;
  const tip = { x: Math.sin(a), y: -Math.cos(a) };
  return (
    <span aria-hidden className="pointer-events-none absolute right-1.5 bottom-1.5 flex size-8 items-center justify-center">
      <svg viewBox="-12 -12 24 24" className="size-8 text-ink-3">
        <circle r="11" fill="var(--surface-1)" stroke="var(--line)" strokeWidth="1" />
        <path
          d="M0 -4.2 L2.1 2.6 L0 1.5 L-2.1 2.6 Z"
          fill="currentColor"
          transform={`translate(${(-tip.x * 2.2).toFixed(2)} ${(-tip.y * 2.2).toFixed(2)}) rotate(${-bearing})`}
        />
        <text
          x={(tip.x * 6.6).toFixed(2)}
          y={(tip.y * 6.6 + 1.9).toFixed(2)}
          textAnchor="middle"
          fontSize="5.4"
          fontWeight="600"
          fill="currentColor"
        >
          N
        </text>
      </svg>
    </span>
  );
}

/**
 * Collision pass: highest priority first, each label takes its full form if it fits,
 * else its compact form, else hides ("compact-first" places compact forms first and
 * then upgrades). Runs on resize and when states change.
 */
function useLabelModes(
  boxRef: React.RefObject<HTMLDivElement | null>,
  box: { w: number; h: number } | null,
  tables: VenueTable[],
  views: Record<string, PlanTableView>,
  selected: string | null,
  hovered: string | null,
  frame: PlanFrame,
  labelFit: "full-first" | "compact-first",
): Record<string, LabelMode> {
  const [modes, setModes] = useState<Record<string, LabelMode>>({});
  useEffect(() => {
    const el = boxRef.current;
    if (!el || !box) return;
    const measure = (code: string, variant: "full" | "compact") => {
      const node = el.querySelector<HTMLElement>(`[data-label="${code}"] [data-variant="${variant}"]`);
      if (!node) return 0;
      // Hidden variants report zero; measure a clone off-screen.
      const clone = node.cloneNode(true) as HTMLElement;
      clone.className = "";
      const pill = node.parentElement!.cloneNode(false) as HTMLElement;
      pill.style.position = "absolute";
      pill.style.visibility = "hidden";
      pill.style.left = "-9999px";
      pill.appendChild(clone);
      el.appendChild(pill);
      const w = pill.getBoundingClientRect().width;
      pill.remove();
      return w;
    };
    const order = tables
      .filter((t) => views[t.id])
      .map((t) => {
        const v = views[t.id]!;
        const p = selected === t.id ? 100 : hovered === t.id ? 50 : v.priority;
        return { t, v, p };
      })
      .sort((a, b) => b.p - a.p);
    type Rect = { x1: number; y1: number; x2: number; y2: number };
    const placed: Rect[] = [];
    const next: Record<string, LabelMode> = {};
    const H = 24;
    const GAP = 4;
    const hits = (r: Rect, others: Rect[]) => others.some((q) => r.x1 < q.x2 && r.x2 > q.x1 && r.y1 < q.y2 && r.y2 > q.y1);
    const rectFor = (t: VenueTable, v: PlanTableView, variant: "full" | "compact"): Rect | null => {
      const at = project(frame, { x: t.x, z: t.z });
      const centerX = (at.left / 100) * box.w;
      const centerY = (at.top / 100) * box.h;
      // A badge (the portal's "Paid 7:30") can be wider than its label; reserve its width too.
      const badgeW = v.badge ? (el.querySelector<HTMLElement>(`[data-label="${t.id}"] [data-badge]`)?.offsetWidth ?? 0) : 0;
      const w = Math.max(measure(t.id, variant), badgeW);
      const height = v.badge ? H + 22 : H;
      const r = {
        x1: centerX - w / 2 - GAP,
        y1: centerY - H / 2 - GAP,
        x2: centerX + w / 2 + GAP,
        y2: centerY - H / 2 + height + GAP,
      };
      return r.x1 < -8 || r.x2 > box.w + 8 ? null : r;
    };
    const variants = labelFit === "compact-first" ? (["compact"] as const) : (["full", "compact"] as const);
    const kept: { t: VenueTable; v: PlanTableView; r: Rect }[] = [];
    for (const { t, v, p } of order) {
      if (p <= 0) {
        next[t.id] = "hidden";
        continue;
      }
      let chosen: LabelMode = "hidden";
      for (const variant of variants) {
        const r = rectFor(t, v, variant);
        if (r && !hits(r, placed)) {
          placed.push(r);
          kept.push({ t, v, r });
          chosen = variant;
          break;
        }
      }
      next[t.id] = chosen;
    }
    if (labelFit === "compact-first") {
      // Second pass, highest priority first: grow a label to its full form where that touches nobody.
      for (const k of kept) {
        const full = rectFor(k.t, k.v, "full");
        if (!full) continue;
        const others = placed.filter((q) => q !== k.r);
        if (hits(full, others)) continue;
        placed[placed.indexOf(k.r)] = full;
        k.r = full;
        next[k.t.id] = "full";
      }
    }
    setModes(next);
  }, [boxRef, box, tables, views, selected, hovered, frame, labelFit]);
  return modes;
}
