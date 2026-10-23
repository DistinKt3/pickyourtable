/**
 * Validation shared by the portal's server routes and its forms, so the owner sees
 * the same answer before saving that the server gives after.
 */

export interface TurnTimeRange {
  minParty: number;
  maxParty: number;
  minutes: number;
}

/**
 * Turn times must cover every party size from 1 to the venue's largest party with no
 * gaps and no overlaps. Returns a plain-words problem, or null when the ranges are valid.
 */
export function turnTimeProblem(ranges: TurnTimeRange[], maxParty: number): string | null {
  if (ranges.length === 0) return "Add a turn time for every party size.";
  const sorted = [...ranges].sort((a, b) => a.minParty - b.minParty);
  let next = 1;
  for (const r of sorted) {
    if (r.maxParty < r.minParty) return `The range ${r.minParty} to ${r.maxParty} runs backwards.`;
    if (r.minParty > next) return gap(next, r.minParty - 1);
    if (r.minParty < next) return `Party size ${r.minParty} is covered twice.`;
    next = r.maxParty + 1;
  }
  if (next <= maxParty) return gap(next, maxParty);
  return null;
}

function gap(from: number, to: number): string {
  const sizes = from === to ? `Parties of ${from}` : `Parties of ${from} to ${to}`;
  return `${sizes} have no turn time.`;
}

const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
const name = (isoDay: number) => DAY_NAMES[isoDay - 1]!;

/** ISO weekdays (1 = Monday) -> "Sun to Thu", "Fri, Sat" or "Sun". */
export function describeDays(days: number[]): string {
  const set = new Set(days);
  if (set.size === 0) return "No days";
  if (set.size === 7) return "Every day";
  // Walk the week starting on Monday and find runs; wrap Sunday onto Monday.
  const order = [1, 2, 3, 4, 5, 6, 7];
  // Rotate so that a run never starts in the middle of the week's wrap-around.
  const start = order.find((d) => set.has(d) && !set.has(d === 1 ? 7 : d - 1)) ?? 1;
  const rotated = [...order.slice(order.indexOf(start)), ...order.slice(0, order.indexOf(start))];
  const runs: number[][] = [];
  for (const d of rotated) {
    if (!set.has(d)) continue;
    const last = runs.at(-1);
    const prev = last?.at(-1);
    if (last && prev !== undefined && (prev % 7) + 1 === d) last.push(d);
    else runs.push([d]);
  }
  return runs
    .map((r) => {
      if (r.length === 1) return name(r[0]!);
      if (r.length === 2) return `${name(r[0]!)}, ${name(r[1]!)}`;
      return `${name(r[0]!)} to ${name(r.at(-1)!)}`;
    })
    .join(", ");
}

/** The ISO weekdays a daypart runs on that are priced as weekend or weeknight. */
export function daysFor(daypartDays: number[], weekendDays: number[], dayType: "weeknight" | "weekend"): number[] {
  const weekend = new Set(weekendDays);
  return daypartDays.filter((d) => (dayType === "weekend" ? weekend.has(d) : !weekend.has(d))).sort((a, b) => a - b);
}

export const MAX_ATTRIBUTES = 3;
