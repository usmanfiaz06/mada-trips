-- Places (src/db/app-schema-places.ts). Pending: the lead folds this into one generated migration.
-- Search needs two contrib extensions: pg_trgm (fuzzy and substring matching) and unaccent (é = e).
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;
--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS unaccent WITH SCHEMA public;
--> statement-breakpoint
-- unaccent() is only STABLE (its dictionary could change), so indexes and the search use this IMMUTABLE wrapper.
CREATE OR REPLACE FUNCTION app_places_norm(t text) RETURNS text
  LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT
  AS $$ SELECT lower(public.unaccent('public.unaccent'::regdictionary, t)) $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "app_place_countries" (
	"code" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"name_ar" text,
	"capital" text,
	"continent" text,
	"currency_code" text,
	"currency_name" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "app_places" (
	"id" integer PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"name_ar" text,
	"region" text,
	"country_code" text NOT NULL REFERENCES "app_place_countries"("code"),
	"lat" double precision NOT NULL,
	"lon" double precision NOT NULL,
	"timezone" text NOT NULL,
	"population" bigint DEFAULT 0 NOT NULL,
	"feature_code" text NOT NULL,
	"is_capital" boolean DEFAULT false NOT NULL,
	"airports" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"iata" text,
	"curation" text DEFAULT 'basic' NOT NULL,
	"served" boolean DEFAULT false NOT NULL,
	"photo" text,
	"booking_key" text,
	"wikipedia_title" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "app_places_slug_idx" ON "app_places" ("slug");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "app_places_country_idx" ON "app_places" ("country_code","population");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "app_place_names" (
	"place_id" integer NOT NULL REFERENCES "app_places"("id") ON DELETE cascade,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"norm" text NOT NULL,
	"label" text,
	"rank" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "app_place_names_pk" PRIMARY KEY ("place_id","kind","norm")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "app_place_names_trgm_idx" ON "app_place_names" USING gin ("norm" gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "app_place_names_prefix_idx" ON "app_place_names" ("norm" text_pattern_ops);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "app_place_airports" (
	"iata" text PRIMARY KEY NOT NULL,
	"icao" text,
	"name" text NOT NULL,
	"municipality" text,
	"country_code" text NOT NULL,
	"lat" double precision NOT NULL,
	"lon" double precision NOT NULL,
	"size" text NOT NULL,
	"city_id" integer REFERENCES "app_places"("id") ON DELETE set null,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "app_place_airports_city_idx" ON "app_place_airports" ("city_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "app_place_guides" (
	"place_id" integer PRIMARY KEY NOT NULL REFERENCES "app_places"("id") ON DELETE cascade,
	"guide" jsonb NOT NULL,
	"status" text NOT NULL,
	"fetched_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"refreshing_at" timestamp with time zone,
	"last_problem" text
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "app_place_guides_expires_idx" ON "app_place_guides" ("expires_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "app_place_plans" (
	"request_id" uuid PRIMARY KEY NOT NULL REFERENCES "app_requests"("id") ON DELETE cascade,
	"place_id" integer NOT NULL REFERENCES "app_places"("id") ON DELETE cascade,
	"owner_id" uuid NOT NULL REFERENCES "app_users"("id") ON DELETE cascade,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "app_place_plans_place_idx" ON "app_place_plans" ("place_id","created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "app_place_plans_owner_idx" ON "app_place_plans" ("owner_id","created_at");
