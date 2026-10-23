import type { TableSuggestion } from "@/lib/api/contracts";
import { tableDistance } from "@/lib/venue/geometry";

/**
 * "Most similar free table" (PRD G-6 and the guest states table), offered when the
 * table a guest wanted is taken. Ranked in order of what a guest gave up least:
 * the same tier, then the most shared attributes (window, booth, water view), then the
 * nearest table in the room, then the closest fee. Only free tables that fit the party
 * are candidates; the caller filters them.
 */

export interface SimilarCandidate {
  code: string;
  label: string;
  tier: string;
  attributes: readonly string[];
  x: number;
  z: number;
  feeCents: number;
}

export function rankSimilar(target: SimilarCandidate, candidates: readonly SimilarCandidate[]): SimilarCandidate[] {
  const wanted = new Set(target.attributes);
  const scored = candidates
    .filter((c) => c.code !== target.code)
    .map((c) => ({
      c,
      sameTier: c.tier === target.tier ? 1 : 0,
      shared: c.attributes.filter((a) => wanted.has(a)).length,
      distance: tableDistance(target, c),
      feeGap: Math.abs(c.feeCents - target.feeCents),
    }));
  scored.sort(
    (a, b) =>
      b.sameTier - a.sameTier ||
      b.shared - a.shared ||
      a.distance - b.distance ||
      a.feeGap - b.feeGap ||
      a.c.code.localeCompare(b.c.code),
  );
  return scored.map((s) => s.c);
}

export function mostSimilar(target: SimilarCandidate, candidates: readonly SimilarCandidate[]): TableSuggestion | null {
  const best = rankSimilar(target, candidates)[0];
  return best ? { code: best.code, label: best.label, tier: best.tier, feeCents: best.feeCents } : null;
}
