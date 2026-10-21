CREATE TABLE "app_drive_cache" (
	"key" text PRIMARY KEY NOT NULL,
	"mode" text DEFAULT 'drive' NOT NULL,
	"bucket" text NOT NULL,
	"provider" text NOT NULL,
	"result" jsonb NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app_drive_budget" (
	"day" date PRIMARY KEY NOT NULL,
	"calls" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX "app_drive_cache_expires_idx" ON "app_drive_cache" USING btree ("expires_at");
