import type { TableAvailability } from "@/lib/api/contracts";
import { formatMoney } from "@/lib/format";
import type { RoomTable, VisualState } from "@/lib/room/types";
import type { Tier } from "@/lib/venue/schema";

/**
 * Label content and the collision pass. Labels are HTML pills positioned from 3D;
 * they never overlap: higher-priority labels claim screen space first, and the rest
 * fade out until there is room.
 */

export const PRIORITY = {
  selected: 5,
  hovered: 4,
  available: 3,
  bookable: 2,
  quiet: 1,
} as const;

export function labelPriority(state: VisualState, opts: { selected: boolean; hovered: boolean }): number {
  if (opts.selected) return PRIORITY.selected;
  if (opts.hovered) return PRIORITY.hovered;
  if (state === "available") return PRIORITY.available;
  if (state === "not_bookable") return PRIORITY.quiet;
  return PRIORITY.bookable;
}

export interface LabelContent {
  title: string;
  price: string | null;
  muted: boolean;
  accessibleName: string;
}

const STATE_WORDS: Record<VisualState, string> = {
  available: "available",
  taken: "taken",
  wrong_size: "not the right size for your party",
  not_bookable: "seated by the host, not bookable online",
};

export function labelContent(
  table: RoomTable,
  tier: Tier,
  state: VisualState,
  availability: TableAvailability | null | undefined,
): LabelContent {
  let price: string | null = null;
  if (table.bookable && state !== "not_bookable") {
    if (availability && availability.feeCents != null) price = formatMoney(availability.feeCents);
    else if (!availability && table.fromCents != null) price = `from ${formatMoney(table.fromCents)}`;
  }
  const seatsWord = table.seats === 1 ? "1 seat" : `${table.seats} seats`;
  const parts = [table.label, tier.name, seatsWord, STATE_WORDS[state]];
  if (price && state === "available") parts.push(price);
  return {
    title: table.label,
    price,
    muted: state === "taken" || state === "wrong_size",
    accessibleName: parts.join(", "),
  };
}

export interface LabelBox {
  code: string;
  priority: number;
  /** Center of the pill in CSS pixels. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** Behind the camera or outside the viewport. */
  offscreen: boolean;
  /** Focused labels always show. */
  forced: boolean;
  /** Distance from the camera, for tie-breaking: nearer wins. */
  depth: number;
  /** Optional order within a priority (lower first), before depth. */
  order?: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function boxRect(b: Pick<LabelBox, "x" | "y" | "width" | "height">): Rect {
  return { x: b.x - b.width / 2, y: b.y - b.height / 2, width: b.width, height: b.height };
}

export function rectsOverlap(a: Rect, b: Rect, gap = 0): boolean {
  return a.x < b.x + b.width + gap && b.x < a.x + a.width + gap && a.y < b.y + b.height + gap && b.y < a.y + a.height + gap;
}

/**
 * Greedy placement by priority (forced, then priority, then nearer to the camera).
 * Returns the codes that show. `gap` keeps a little air between pills.
 */
export function resolveLabels(boxes: LabelBox[], viewport: { width: number; height: number }, gap = 6): Set<string> {
  const order = [...boxes].sort((a, b) => {
    if (a.forced !== b.forced) return a.forced ? -1 : 1;
    if (a.priority !== b.priority) return b.priority - a.priority;
    const ao = a.order ?? 0;
    const bo = b.order ?? 0;
    if (ao !== bo) return ao - bo;
    if (a.depth !== b.depth) return a.depth - b.depth;
    return a.code < b.code ? -1 : 1;
  });
  const placed: Rect[] = [];
  const shown = new Set<string>();
  for (const b of order) {
    if (b.offscreen) continue;
    const r = boxRect(b);
    const inside = r.x >= 0 && r.y >= 0 && r.x + r.width <= viewport.width && r.y + r.height <= viewport.height;
    if (!inside && !b.forced) continue;
    if (placed.some((p) => rectsOverlap(p, r, gap))) continue;
    placed.push(r);
    shown.add(b.code);
  }
  return shown;
}

/**
 * Fair order inside a priority: the first table of every tier, then the second of
 * every tier, and so on, each tier walked across the screen. When not every label
 * fits, the plan still shows every tier and its price.
 */
export function roundRobinOrder(items: { code: string; group: string; x: number; y: number }[]): Map<string, number> {
  const groups = new Map<string, { code: string; x: number; y: number }[]>();
  for (const it of items) {
    const list = groups.get(it.group) ?? [];
    list.push(it);
    groups.set(it.group, list);
  }
  const out = new Map<string, number>();
  let g = 0;
  for (const list of groups.values()) {
    list.sort((a, b) => a.x - b.x || a.y - b.y);
    list.forEach((it, i) => out.set(it.code, i * 64 + g));
    g++;
  }
  return out;
}
