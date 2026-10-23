-- PRD S-2: the database itself refuses overlapping holds or bookings on one table.
-- Expired, cancelled and no-show rows do not block; held, confirmed and seated do.
CREATE EXTENSION IF NOT EXISTS btree_gist;
--> statement-breakpoint
ALTER TABLE "reservation" ADD CONSTRAINT "no_overlap"
  EXCLUDE USING gist ("table_id" WITH =, "during" WITH &&)
  WHERE ("status" IN ('held', 'confirmed', 'seated'));
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "blackout_during" ON "blackout" USING gist ("venue_id", "during");
--> statement-breakpoint
-- A guest's details exist only to serve one booking (PRD privacy table).
CREATE INDEX IF NOT EXISTS "reservation_guest" ON "reservation" ("guest_id");
