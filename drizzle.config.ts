import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./db/schema.ts",
  out: "./db/migrations",
  dbCredentials: { url: process.env.DATABASE_URL ?? "postgres://pyt:pyt_local_only@127.0.0.1:54329/pyt" },
  strict: true,
  verbose: false,
});
