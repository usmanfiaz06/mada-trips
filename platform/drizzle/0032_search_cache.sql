CREATE TABLE "app_search_cache" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "app_search_cache_created_idx" ON "app_search_cache" USING btree ("created_at");