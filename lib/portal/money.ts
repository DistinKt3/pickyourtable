/**
 * Money inputs in the portal are typed in dollars and stored as integer cents.
 * Parsing works on the string, never through floating-point multiplication, so
 * "19.99" is exactly 1999 cents.
 */

export const MAX_FEE_CENTS = 100_000;

const DOLLARS = /^(\d{1,6})(?:\.(\d{0,2}))?$/;

/** "25" -> 2500, "$25.5" -> 2550, "19.99" -> 1999, ".5" -> 50. Null for anything that is not a fee. */
export function parseDollars(input: string): number | null {
  let s = input
    .trim()
    .replace(/^\$\s*/, "")
    .replace(/,/g, "");
  if (s.startsWith(".")) s = `0${s}`;
  const match = DOLLARS.exec(s);
  if (!match) return null;
  const whole = Number(match[1]);
  const frac = Number((match[2] ?? "").padEnd(2, "0"));
  const cents = whole * 100 + frac;
  if (!Number.isSafeInteger(cents) || cents > MAX_FEE_CENTS) return null;
  return cents;
}

/** 2500 -> "25", 2550 -> "25.50": the value an input shows for a stored fee. */
export function centsToInput(cents: number): string {
  const whole = Math.floor(cents / 100);
  const rest = cents % 100;
  return rest === 0 ? String(whole) : `${whole}.${String(rest).padStart(2, "0")}`;
}
