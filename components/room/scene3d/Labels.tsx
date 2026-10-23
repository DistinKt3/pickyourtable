"use client";

import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { cx } from "@/lib/format";
import { useRoom } from "@/lib/room/store";
import { type RoomData, type RoomTable, tierOf, visualState } from "@/lib/room/types";
import { labelAnchor, type Vec3 } from "@/lib/venue/geometry";
import { distanceOf } from "./cameraMath";
import { fitLabels, type LabelBox, labelContent, labelPriority, PRIORITY, roundRobinOrder } from "./labelsLayout";
import type { Theme } from "./palette";
import { measureLabel, registerLabel, type LabelSlot, type Runtime, setFocused, useRuntime } from "./runtime";

/**
 * Table labels as real HTML buttons over the canvas: always upright and screen
 * aligned, crisp, a fixed size on screen, and never overlapping. The projector below
 * moves them each frame through refs (no React render per frame) and runs the
 * collision pass; losers fade out.
 */

function TableLabel({ table, data, theme, rt }: { table: RoomTable; data: RoomData; theme: Theme; rt: Runtime }) {
  const a = useRoom((s) => s.availability?.[table.id]);
  const isSelected = useRoom((s) => s.selected === table.id);
  const hover = useRoom((s) => s.hover);
  const select = useRoom((s) => s.select);
  const tier = tierOf(data.venue, table.tier);
  const state = visualState(table, a);
  const content = labelContent(table, tier, state, a);
  const button = useRef<HTMLButtonElement>(null);
  const pill = useRef<HTMLSpanElement>(null);
  const price = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const b = button.current;
    const p = pill.current;
    if (!b || !p) return;
    const slot: LabelSlot = {
      button: b,
      pill: p,
      price,
      baseWidth: 0,
      priceWidth: 0,
      height: 0,
      shown: false,
      compact: false,
    };
    measureLabel(rt, slot);
    const unregister = registerLabel(rt, table.id, slot);
    // The price is watched too: it can change while hidden without resizing the pill.
    const ro = new ResizeObserver(() => measureLabel(rt, slot));
    ro.observe(p);
    if (price.current) ro.observe(price.current);
    return () => {
      ro.disconnect();
      unregister();
    };
  }, [rt, table.id]);

  const dot = theme === "dark" ? tier.colorDark : tier.color;
  return (
    <button
      ref={button}
      type="button"
      aria-label={content.accessibleName}
      aria-pressed={isSelected}
      data-show="false"
      data-compact="false"
      data-code={table.id}
      className={cx(
        "group pointer-events-auto absolute top-0 left-0 flex min-h-11 min-w-11 items-center justify-center p-2 opacity-100 outline-none",
        "transition-opacity duration-200 ease-out will-change-transform",
        "data-[show=false]:pointer-events-none data-[show=false]:opacity-0 focus-visible:data-[show=false]:opacity-100",
      )}
      onClick={() => select(table.id)}
      onPointerEnter={() => hover(table.id)}
      onPointerLeave={() => {
        if (useRoom.getState().hovered === table.id) hover(null);
      }}
      onFocus={() => {
        setFocused(rt, table.id);
        hover(table.id);
      }}
      onBlur={() => {
        setFocused(rt, null, table.id);
        if (useRoom.getState().hovered === table.id) hover(null);
      }}
    >
      <span
        ref={pill}
        className={cx(
          "inline-flex h-7 items-center gap-1.5 rounded-full px-2.5 text-[13px] leading-none font-medium whitespace-nowrap tabular shadow-chip",
          "transition-[background-color,color,box-shadow] duration-200 ease-out",
          "group-focus-visible:ring-2 group-focus-visible:ring-accent group-focus-visible:ring-offset-1 group-focus-visible:ring-offset-surface-0",
          isSelected ? "bg-ink text-surface-1" : "bg-surface-1 text-ink",
          content.muted && !isSelected && "text-ink-3",
        )}
      >
        {table.bookable ? (
          <span
            aria-hidden
            className={cx("size-1.5 shrink-0 rounded-full", content.muted && "opacity-40")}
            style={{ background: isSelected ? "currentColor" : dot }}
          />
        ) : null}
        <span>{content.title}</span>
        {/* When the plan is crowded the prices give way so every table keeps its name;
            the selected table keeps its price, and the accessible name always has it. */}
        <span
          ref={price}
          className={cx(
            "font-normal empty:hidden",
            isSelected ? "text-surface-3" : "text-ink-3 group-data-[compact=true]:invisible group-data-[compact=true]:absolute",
          )}
        >
          {content.price}
        </span>
      </span>
    </button>
  );
}

export function LabelLayer({ data, theme, rt, hidden }: { data: RoomData; theme: Theme; rt: Runtime; hidden: boolean }) {
  return (
    <div
      className={cx("pointer-events-none absolute inset-0 overflow-hidden", hidden && "invisible")}
      aria-hidden={hidden || undefined}
    >
      {data.tables.map((t) => (
        <TableLabel key={t.id} table={t} data={data} theme={theme} rt={rt} />
      ))}
    </div>
  );
}

const v = new THREE.Vector3();

/**
 * One frame of labels: project every anchor (lifted with its table), rank them, run
 * the collision pass and write transforms and visibility straight to the DOM.
 */
function projectLabels(
  rt: Runtime,
  data: RoomData,
  anchors: Vec3[],
  camera: THREE.Camera,
  size: { width: number; height: number },
) {
  const st = useRoom.getState();
  camera.updateMatrixWorld();
  const hideAll = rt.sit > 0.02 || st.sitting != null;
  const distance = distanceOf({ x: camera.position.x, y: camera.position.y, z: camera.position.z }, rt.camera.target);
  const far = distance > rt.overviewDistance * 1.12;
  // Tables seated by the host only get a label once the guest has zoomed in.
  const close = distance < rt.overviewDistance * 0.62;
  const edge = 8;
  const items: Projected[] = [];
  data.tables.forEach((t, i) => {
    const slot = rt.labels.get(t.id);
    if (!slot) return;
    const a = anchors[i]!;
    v.set(a.x, a.y + (rt.lift.get(t.id) ?? 0), a.z).project(camera);
    const ax = ((v.x + 1) / 2) * size.width;
    const ay = ((1 - v.y) / 2) * size.height;
    // The table must be on screen; its pill may slide inward to stay whole.
    const anchorOff = v.z > 1 || ax < 0 || ax > size.width || ay < 0 || ay > size.height;
    const isSelected = st.selected === t.id;
    const state = visualState(t, st.availability?.[t.id]);
    let priority = labelPriority(state, { selected: isSelected, hovered: st.hovered === t.id });
    // Zoomed far out, only the selected, hovered and available tables compete for room.
    if (far && priority < PRIORITY.available) priority = -1;
    if (!close && priority === PRIORITY.quiet) priority = -1;
    const full = slot.baseWidth + slot.priceWidth;
    items.push({
      code: t.id,
      group: `${priority}:${t.tier}`,
      priority,
      ax,
      // The pill floats just above its table, so the table itself stays in view.
      y: Math.max(slot.height / 2 + edge, ay - slot.height / 2 - 6),
      full,
      small: isSelected ? full : slot.baseWidth,
      height: slot.height,
      offscreen: hideAll || priority < 0 || anchorOff || !Number.isFinite(ax),
      forced: rt.focused === t.id,
      depth: camera.position.distanceTo(v.set(a.x, a.y, a.z)),
    });
  });
  const order = roundRobinOrder(items.map((b) => ({ code: b.code, group: b.group, x: b.ax, y: b.y })));
  const fit = fitLabels(
    (compact) =>
      items.map((it): LabelBox => {
        const width = compact ? it.small : it.full;
        return {
          code: it.code,
          priority: it.priority,
          x: Math.min(size.width - width / 2 - edge, Math.max(width / 2 + edge, it.ax)),
          y: it.y,
          width,
          height: it.height,
          offscreen: it.offscreen,
          forced: it.forced,
          depth: it.depth,
          order: order.get(it.code) ?? 0,
        };
      }),
    size,
  );
  for (const b of fit.boxes) {
    const slot = rt.labels.get(b.code)!;
    // The button is the pill plus 8 px of hit area on every side, at least 44 px.
    const bw = Math.max(44, b.width + 16);
    const bh = Math.max(44, b.height + 16);
    slot.button.style.transform = `translate3d(${Math.round(b.x - bw / 2)}px, ${Math.round(b.y - bh / 2)}px, 0)`;
    const show = fit.shown.has(b.code);
    if (show !== slot.shown || rt.labelsDirty) {
      slot.shown = show;
      slot.button.dataset.show = show ? "true" : "false";
    }
    if (fit.compact !== slot.compact || rt.labelsDirty) {
      slot.compact = fit.compact;
      slot.button.dataset.compact = fit.compact ? "true" : "false";
    }
  }
  rt.labelsDirty = false;
}

/** One table's label after projection, before the full or compact width is chosen. */
interface Projected {
  code: string;
  group: string;
  priority: number;
  ax: number;
  y: number;
  full: number;
  small: number;
  height: number;
  offscreen: boolean;
  forced: boolean;
  depth: number;
}

/** Inside the canvas: runs the label pass after the camera has moved, every rendered frame. */
export function LabelProjector({ data }: { data: RoomData }) {
  const rt = useRuntime();
  const anchors = useMemo(() => data.tables.map((t) => labelAnchor(t)), [data.tables]);
  useFrame((state) => projectLabels(rt, data, anchors, state.camera, state.size), 0);
  return null;
}
