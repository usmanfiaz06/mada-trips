-- Credit each sale to the salesperson who made it, not just whoever typed it in. "sold_by" defaults to the
-- preparer; existing rows are backfilled to prepared_by so commission and reporting are unchanged for them.
ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "sold_by" uuid REFERENCES "users"("id");
--> statement-breakpoint
UPDATE "bookings" SET "sold_by" = "prepared_by" WHERE "sold_by" IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bookings_sold_by_idx" ON "bookings" ("sold_by");
