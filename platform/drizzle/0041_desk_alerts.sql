CREATE TABLE "desk_alerts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"kind" text NOT NULL,
	"tone" text NOT NULL,
	"href" text NOT NULL,
	"data" jsonb NOT NULL,
	"fired_at" timestamp with time zone DEFAULT now() NOT NULL,
	"cleared_at" timestamp with time zone,
	"paged" text
);
--> statement-breakpoint
CREATE UNIQUE INDEX "desk_alerts_open_key" ON "desk_alerts" USING btree ("key") WHERE "desk_alerts"."cleared_at" IS NULL;--> statement-breakpoint
CREATE INDEX "desk_alerts_fired_idx" ON "desk_alerts" USING btree ("fired_at");