import { existsSync } from "node:fs";

/** Scripts read the same `.env.local` that `next dev` reads. Real environment wins. */
for (const file of [".env.local", ".env"]) {
  if (existsSync(file)) {
    const before = { ...process.env };
    process.loadEnvFile(file);
    Object.assign(process.env, before);
  }
}
