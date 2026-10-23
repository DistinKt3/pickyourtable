import "./_env";
import { closeDb } from "@/db/client";
import { setFlag, WIDGET_FLAG } from "@/lib/flags";

/**
 * Turns a feature flag on or off. The kill switch (PRD S-5):
 *
 *   npx tsx --conditions=react-server scripts/flag.ts pyt_widget_enabled off
 *   npx tsx --conditions=react-server scripts/flag.ts pyt_widget_enabled on
 *
 * Each server instance caches the flag for 15 s, so guests see the change within a minute.
 */

const [key, value] = process.argv.slice(2);
const states: Record<string, boolean> = { on: true, off: false, true: true, false: false };

if (!key || !/^[a-z0-9_]{1,64}$/.test(key) || value === undefined || !(value in states)) {
  console.error(`Usage: flag.ts <key> on|off   (for example: flag.ts ${WIDGET_FLAG} off)`);
  process.exit(2);
}

try {
  await setFlag(key, states[value]!);
  console.log(JSON.stringify({ event: "flag.set", key, enabled: states[value] }));
} finally {
  await closeDb();
}
