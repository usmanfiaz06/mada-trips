CREATE TABLE "app_activities" (
	"id" text PRIMARY KEY NOT NULL,
	"place_id" integer NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"name_ar" text,
	"lat" double precision NOT NULL,
	"lon" double precision NOT NULL,
	"wikidata" text,
	"wikipedia_title" text,
	"summary" text,
	"summary_ar" text,
	"image" jsonb,
	"hours" text,
	"indoor" boolean DEFAULT false NOT NULL,
	"family" boolean DEFAULT false NOT NULL,
	"free" boolean,
	"website" text,
	"sitelinks" integer DEFAULT 0 NOT NULL,
	"pageviews" integer DEFAULT 0 NOT NULL,
	"score" real DEFAULT 0 NOT NULL,
	"popularity" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app_activity_cities" (
	"place_id" integer PRIMARY KEY NOT NULL,
	"status" text DEFAULT 'none' NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	"fetched_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"refreshing_at" timestamp with time zone,
	"last_problem" text,
	"weather" jsonb,
	"weather_at" timestamp with time zone,
	"events" jsonb,
	"events_at" timestamp with time zone,
	"experiences" jsonb,
	"experiences_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "app_geocodes" (
	"query" text PRIMARY KEY NOT NULL,
	"lat" double precision,
	"lon" double precision,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app_trip_ideas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trip_id" uuid NOT NULL,
	"owner_id" uuid NOT NULL,
	"ref_kind" text NOT NULL,
	"ref_id" text NOT NULL,
	"day" date,
	"title" text NOT NULL,
	"sub" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app_whats_on" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"place_id" integer NOT NULL,
	"title" text NOT NULL,
	"title_ar" text,
	"body" text,
	"body_ar" text,
	"starts_on" date NOT NULL,
	"ends_on" date NOT NULL,
	"time" text,
	"venue" text,
	"image_url" text,
	"image_credit" text,
	"link" text,
	"family" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "app_activities" ADD CONSTRAINT "app_activities_place_id_app_places_id_fk" FOREIGN KEY ("place_id") REFERENCES "public"."app_places"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_activity_cities" ADD CONSTRAINT "app_activity_cities_place_id_app_places_id_fk" FOREIGN KEY ("place_id") REFERENCES "public"."app_places"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_trip_ideas" ADD CONSTRAINT "app_trip_ideas_trip_id_app_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."app_trips"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_trip_ideas" ADD CONSTRAINT "app_trip_ideas_owner_id_app_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."app_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_whats_on" ADD CONSTRAINT "app_whats_on_place_id_app_places_id_fk" FOREIGN KEY ("place_id") REFERENCES "public"."app_places"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "app_activities_place_idx" ON "app_activities" USING btree ("place_id","popularity");--> statement-breakpoint
CREATE INDEX "app_activity_cities_expires_idx" ON "app_activity_cities" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "app_trip_ideas_once_idx" ON "app_trip_ideas" USING btree ("trip_id","ref_id");--> statement-breakpoint
CREATE INDEX "app_trip_ideas_owner_idx" ON "app_trip_ideas" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "app_whats_on_place_idx" ON "app_whats_on" USING btree ("place_id","ends_on");