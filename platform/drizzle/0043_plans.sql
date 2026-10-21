ALTER TABLE "app_trips" ADD COLUMN "origin" jsonb;--> statement-breakpoint
ALTER TABLE "app_trips" ADD COLUMN "title" text;--> statement-breakpoint
ALTER TABLE "app_trips" ADD COLUMN "kind" text DEFAULT 'simple' NOT NULL;--> statement-breakpoint
CREATE TABLE "app_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trip_id" uuid NOT NULL,
	"owner_id" uuid NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"origin" jsonb,
	"return_to" jsonb,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"pace" text DEFAULT 'normal' NOT NULL,
	"template_id" text,
	"notes" text[] DEFAULT '{}'::text[] NOT NULL,
	"checks" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_by" text DEFAULT 'ask' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app_plan_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plan_id" uuid NOT NULL,
	"day" integer,
	"sort" integer DEFAULT 0 NOT NULL,
	"kind" text NOT NULL,
	"mode" text,
	"title" text NOT NULL,
	"note" text,
	"place" jsonb,
	"from_place" jsonb,
	"to_place" jsonb,
	"starts_at" text,
	"ends_at" text,
	"tz" text,
	"nights" integer,
	"status" text DEFAULT 'idea' NOT NULL,
	"status_note" text,
	"booking_kind" text,
	"booking_id" uuid,
	"request_id" uuid,
	"offer_id" uuid,
	"ref" jsonb,
	"drive" jsonb,
	"origin_leg" text,
	"source" text DEFAULT 'ask' NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app_plan_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plan_id" uuid NOT NULL,
	"item_id" uuid,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"by_kind" text NOT NULL,
	"op" text NOT NULL,
	"diff" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"seen_in_thread" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
ALTER TABLE "app_plans" ADD CONSTRAINT "app_plans_trip_id_app_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."app_trips"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_plans" ADD CONSTRAINT "app_plans_owner_id_app_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."app_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_plan_items" ADD CONSTRAINT "app_plan_items_plan_id_app_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."app_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_plan_events" ADD CONSTRAINT "app_plan_events_plan_id_app_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."app_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "app_plans_trip_key" ON "app_plans" USING btree ("trip_id");--> statement-breakpoint
CREATE INDEX "app_plans_owner_idx" ON "app_plans" USING btree ("owner_id","updated_at");--> statement-breakpoint
CREATE INDEX "app_plan_items_plan_idx" ON "app_plan_items" USING btree ("plan_id","day","sort");--> statement-breakpoint
CREATE INDEX "app_plan_items_booking_idx" ON "app_plan_items" USING btree ("booking_kind","booking_id");--> statement-breakpoint
CREATE INDEX "app_plan_events_plan_idx" ON "app_plan_events" USING btree ("plan_id","at");
