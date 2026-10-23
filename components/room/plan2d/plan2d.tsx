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
}

export function Plan2D(props: Plan2DProps) {
  const { venue } = props;
  const frames = useMemo(
    () => ({ landscape: planFrame(venue, planOrientation(venue, 1.6)), portrait: planFrame(venue, planOrientation(venue, 0.5)) }),
    [venue],
  );
  return (
    <div className={cx("plan-root grid size-full grid-cols-1 grid-rows-1 overflow-hidden", props.className)}>
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
  frame,
  variant,
}: Plan2DProps & { frame: PlanFrame; variant: "landscape" | "portrait" }) {
  const uid = useId().replace(/:/g, "");
  const boxRef = useRef<HTMLDivElement>(null);
  const outerRef = useRef<HTMLElement>(null);
  const [box, setBox] = useState<{ w: number; h: number; left: number; top: number; ow: number; oh: number } | null>(null);
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
    // offsetWidth ignores the focus transform, so labels are laid out at the true scale.
    const ro = new ResizeObserver(() => {
      setBox(
        el.offsetWidth > 0
          ? {
              w: el.offsetWidth,
              h: el.offsetHeight,
              left: el.offsetLeft,
              top: el.offsetTop,
              ow: outer.clientWidth,
              oh: outer.clientHeight,
            }
          : null,
      );
    });
    ro.observe(el);
    ro.observe(outer);
    return () => ro.disconnect();
  }, []);

  const modes = useLabelModes(boxRef, box, tables, views, selected ?? null, hovered ?? null, frame, namedAreas);

  // Keep the focused table visible above the sheet: scale up slightly and pan.
  const { transform, zoom } = useMemo(() => {
    if (!focus || !box) return { transform: "none", zoom: 1 };
    const t = tables.find((x) => x.id === focus.code);
    if (!t) return { transform: "none", zoom: 1 };
    const visibleH = Math.max(160, box.oh - focus.bottomInset);
    const z = Math.min(1.45, Math.max(1.15, (box.oh / visibleH) * 0.6));
    const p = project(frame, { x: t.x, z: t.z });
    const px = (p.left / 100) * box.w;
    const py = (p.top / 100) * box.h;
    const boxLeft = box.left;
    const boxTop = box.top;
    const targetX = box.ow / 2;
    const targetY = visibleH / 2;
    const tx = targetX - (boxLeft + px * z);
    const ty = targetY - (boxTop + py * z);
    return { transform: `translate(${tx.toFixed(1)}px, ${ty.toFixed(1)}px) scale(${z.toFixed(3)})`, zoom: z };
  }, [focus, box, tables, frame]);

  const anySelected = Boolean(selected);

  return (
    <section
      ref={outerRef}
      aria-label={ariaLabel}
      className={cx(
        "relative col-start-1 row-start-1 min-h-0 min-w-0 justify-center",
        variant === "portrait" ? "plan-portrait items-start" : "plan-landscape items-center",
      )}
    >
      <div
        ref={boxRef}
        className="relative origin-top-left transition-transform duration-500 ease-in-out-soft motion-reduce:transition-none"
        style={{
          aspectRatio: `${frame.viewBox.w} / ${frame.viewBox.h}`,
          width: `min(100cqw, calc(100cqh * ${frame.aspect.toFixed(4)}))`,
          transform: focus && transform !== "none" ? transform : undefined,
          transitionDuration: reducedMotion ? "0ms" : undefined,
          ["--plan-zoom" as string]: zoom,
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
            {water ? (
              <linearGradient
                id={`water-${uid}`}
                gradientUnits="userSpaceOnUse"
                x1={water.shore.x1}
                y1={water.shore.z1}
                x2={water.shore.x2}
                y2={water.shore.z2}
              >
                <stop offset="0" stopColor="var(--surface-1)" stopOpacity="0.55" />
                <stop offset="0.35" stopColor="var(--surface-1)" stopOpacity="0" />
                <stop offset="1" stopColor="var(--plan-glass)" stopOpacity="0.18" />
              </linearGradient>
            ) : null}
            <radialGradient id={`glow-${uid}`}>
              <stop offset="0" stopColor="var(--accent-base)" stopOpacity="0.22" />
              <stop offset="1" stopColor="var(--accent-base)" stopOpacity="0" />
            </radialGradient>
          </defs>
          <g transform={`rotate(${frame.rotate})`}>
            {water ? (
              <g aria-hidden>
                <path d={water.path} fill="var(--plan-water)" />
                <path d={water.path} fill={`url(#water-${uid})`} />
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
              data-area={a.id}
              className={cx(
                "absolute -translate-x-1/2 -translate-y-1/2 text-[0.6875rem] font-medium tracking-[0.12em] whitespace-nowrap text-ink-3 uppercase transition-opacity duration-200",
                modes[`area:${a.id}`] === "hidden" ? "opacity-0" : "opacity-100",
              )}
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
                mode={modes[t.id] ?? (selected === t.id ? "full" : view.priority >= 2 ? "compact" : "hidden")}
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
        <g transform={shape.transform} data-top>
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
  const tone = selected ? "bg-ink text-surface-1" : inactive ? "bg-surface-1/90 text-ink-3" : "bg-surface-1 text-ink";
  return (
    <span
      data-label={code}
      data-mode={mode}
      className={cx(
        "absolute flex flex-col items-center gap-0.5 transition-[opacity,scale] duration-200 [scale:calc(1/var(--plan-zoom,1))] [translate:-50%_-50%]",
        mode === "hidden" ? "opacity-0" : "opacity-100",
      )}
      style={{ left: `${at.left}%`, top: `${at.top}%`, zIndex: selected ? 3 : view.priority }}
    >
      <span
        data-variant="full"
        className={cx(
          "flex-col items-center rounded-[11px] px-2 py-1 leading-[1.15] whitespace-nowrap tabular shadow-chip",
          tone,
          mode === "full" ? "flex" : "hidden",
        )}
      >
        <span className="text-[0.8125rem] font-medium">{view.label}</span>
        {view.detail ? (
          <span className={cx("text-[0.75rem]", selected ? "opacity-75" : inactive ? "" : "text-ink-2")}>{view.detail}</span>
        ) : null}
      </span>
      <span
        data-variant="compact"
        className={cx(
          "h-6 items-center rounded-full px-2 text-[0.8125rem] leading-none font-medium whitespace-nowrap tabular shadow-chip",
          tone,
          mode === "full" ? "hidden" : "inline-flex",
        )}
      >
        {view.shortDetail ?? view.short}
      </span>
      {view.badge && mode !== "hidden" ? (
        <span
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
    <span aria-hidden className="pointer-events-none absolute top-1.5 right-1.5 flex size-8 items-center justify-center">
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
 * Collision pass. Small plans (phones) show compact pills and the full label only
 * for the selected table. Larger plans show full labels, but a tier whose labels
 * cannot all fit goes compact as a group, so neighbors never alternate between
 * styles. Anything that still collides, or would leave the plan, hides.
 */
const COMPACT_BELOW_PX_PER_M = 30;

/** Label sizes depend only on their text, so measure each once (per loaded font set). */
const sizeCache = new Map<string, { w: number; h: number }>();

function useLabelModes(
  boxRef: React.RefObject<HTMLDivElement | null>,
  box: { w: number; h: number } | null,
  tables: VenueTable[],
  views: Record<string, PlanTableView>,
  selected: string | null,
  hovered: string | null,
  frame: PlanFrame,
  areas: { id: string; at: { left: number; top: number } }[],
): Record<string, LabelMode> {
  const [modes, setModes] = useState<Record<string, LabelMode>>({});
  useEffect(() => {
    const el = boxRef.current;
    if (!el || !box) return;
    const fontsReady = document.fonts?.status !== "loading";
    const size = (selector: string) => {
      const node = el.querySelector<HTMLElement>(selector);
      if (!node) return { w: 0, h: 0 };
      const key = `${selector.includes("full") ? "f" : selector.includes("compact") ? "c" : "a"}|${node.textContent ?? ""}`;
      const hit = fontsReady ? sizeCache.get(key) : undefined;
      if (hit) return hit;
      const clone = node.cloneNode(true) as HTMLElement;
      clone.classList.remove("hidden");
      clone.classList.add(selector.includes("full") ? "flex" : "inline-flex");
      clone.style.position = "absolute";
      clone.style.visibility = "hidden";
      clone.style.left = "-9999px";
      el.appendChild(clone);
      const r = clone.getBoundingClientRect();
      clone.remove();
      const measured = { w: r.width, h: r.height };
      if (fontsReady) sizeCache.set(key, measured);
      return measured;
    };
    type Rect = { x1: number; y1: number; x2: number; y2: number };
    const GAP = 3;
    const rectAt = (left: number, top: number, w: number, h: number): Rect => {
      const px = (left / 100) * box.w;
      const py = (top / 100) * box.h;
      return { x1: px - w / 2 - GAP, y1: py - h / 2 - GAP, x2: px + w / 2 + GAP, y2: py + h / 2 + GAP };
    };
    const hits = (r: Rect, placed: Rect[]) => placed.some((q) => r.x1 < q.x2 && r.x2 > q.x1 && r.y1 < q.y2 && r.y2 > q.y1);
    const inside = (r: Rect) => r.x1 >= -GAP && r.x2 <= box.w + GAP && r.y1 >= -GAP && r.y2 <= box.h + GAP;

    const order = tables
      .filter((t) => views[t.id])
      .map((t) => {
        const v = views[t.id]!;
        const p = selected === t.id ? 100 : hovered === t.id ? 50 : v.priority;
        const at = project(frame, { x: t.x, z: t.z });
        const badge = v.badge ? 22 : 0;
        const full = size(`[data-label="${t.id}"] [data-variant="full"]`);
        const compact = size(`[data-label="${t.id}"] [data-variant="compact"]`);
        return {
          t,
          p,
          full: rectAt(at.left, at.top, full.w, full.h + badge),
          compact: rectAt(at.left, at.top, compact.w, compact.h + badge),
        };
      })
      .sort((a, b) => b.p - a.p);

    const small = box.w / frame.viewBox.w < COMPACT_BELOW_PX_PER_M;
    const compactTiers = new Set<string>();
    if (!small) {
      const trial: Rect[] = [];
      for (const o of order) {
        if (o.p <= 0 || o.p >= 50) continue;
        if (hits(o.full, trial) || !inside(o.full)) compactTiers.add(o.t.tier);
        else trial.push(o.full);
      }
    }

    const placed: Rect[] = [];
    const next: Record<string, LabelMode> = {};
    for (const o of order) {
      if (o.p <= 0) {
        next[o.t.id] = "hidden";
        continue;
      }
      const wantFull = o.p >= 50 || (!small && !compactTiers.has(o.t.tier));
      const tries: [LabelMode, Rect][] = wantFull
        ? [
            ["full", o.full],
            ["compact", o.compact],
          ]
        : [["compact", o.compact]];
      next[o.t.id] = "hidden";
      for (const [mode, r] of tries) {
        if (inside(r) && !hits(r, placed)) {
          placed.push(r);
          next[o.t.id] = mode;
          break;
        }
      }
    }
    for (const a of areas) {
      const s = size(`[data-area="${a.id}"]`);
      const r = rectAt(a.at.left, a.at.top, s.w, s.h);
      next[`area:${a.id}`] = inside(r) && !hits(r, placed) ? "full" : "hidden";
    }
    setModes(next);
  }, [boxRef, box, tables, views, selected, hovered, frame, areas]);
  return modes;
}
