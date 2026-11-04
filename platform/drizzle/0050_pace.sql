CREATE TABLE IF NOT EXISTS "app_pace" (
	"key" text PRIMARY KEY NOT NULL,
	"n" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "app_pace_updated_idx" ON "app_pace" USING btree ("updated_at");
