/**
 * Structured logs (PRD S-6): one JSON line per event, with IDs, amounts and outcome.
 * Emails are masked and card data never reaches a log line.
 */

type Level = "info" | "warn" | "error";
type Fields = Record<string, unknown>;

const EMAIL = /([A-Za-z0-9._%+-])[A-Za-z0-9._%+-]*@([A-Za-z0-9.-]+\.[A-Za-z]{2,})/g;
const SECRET_KEYS = /secret|token|password|authorization|cookie|card|cvc|client_secret/i;

export function maskEmail(value: string): string {
  return value.replace(EMAIL, (_m, first: string, domain: string) => `${first}***@${domain}`);
}

/** A request path fit for a log line: a manage link's token is a credential, so it is cut out. */
export function logPath(pathname: string): string {
  return pathname.replace(/\/manage\/[^/]+/, "/manage/:token");
}

function scrub(value: unknown, depth = 0): unknown {
  if (depth > 4) return "[depth]";
  if (typeof value === "string") return maskEmail(value);
  if (Array.isArray(value)) return value.map((v) => scrub(v, depth + 1));
  if (value instanceof Error) return { name: value.name, message: maskEmail(value.message) };
  if (value && typeof value === "object") {
    const out: Fields = {};
    for (const [k, v] of Object.entries(value)) out[k] = SECRET_KEYS.test(k) ? "[redacted]" : scrub(v, depth + 1);
    return out;
  }
  return value;
}

function write(level: Level, event: string, fields: Fields) {
  const line = JSON.stringify({ ts: new Date().toISOString(), level, event, ...(scrub(fields) as Fields) });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export const log = {
  info: (event: string, fields: Fields = {}) => write("info", event, fields),
  warn: (event: string, fields: Fields = {}) => write("warn", event, fields),
  error: (event: string, fields: Fields = {}) => write("error", event, fields),
};
