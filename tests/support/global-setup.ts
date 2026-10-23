import pg from "pg";
import "./setup-env";

/** Recreates the test database once per run, then migrates and seeds it. */
export default async function setup() {
  const url = new URL(process.env.DATABASE_URL!);
  const name = url.pathname.slice(1);
  if (!/^pyt_[a-z0-9_]+$/.test(name)) throw new Error(`refusing to reset non-test database ${name}`);
  const admin = new URL(url);
  admin.pathname = "/postgres";
  const client = new pg.Client({ connectionString: admin.toString() });
  await client.connect();
  await client.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
  await client.query(`CREATE DATABASE ${name}`);
  await client.end();

  const { drizzle } = await import("drizzle-orm/node-postgres");
  const { migrate } = await import("drizzle-orm/node-postgres/migrator");
  const pool = new pg.Pool({ connectionString: url.toString(), max: 1 });
  await migrate(drizzle(pool), { migrationsFolder: "db/migrations" });
  await pool.end();

  const { seedVenue } = await import("@/db/seed");
  const { loadVenue, listVenueIds } = await import("@/lib/venue/load");
  for (const id of await listVenueIds()) await seedVenue(await loadVenue(id), { reset: true });
  const { db, closeDb } = await import("@/db/client");
  const { featureFlag } = await import("@/db/schema");
  await db().insert(featureFlag).values({ key: "pyt_widget_enabled", enabled: true }).onConflictDoNothing();
  await closeDb();
}
