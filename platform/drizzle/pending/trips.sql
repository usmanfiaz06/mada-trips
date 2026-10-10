-- Trip companion (src/db/app-schema-trips.ts). Pending: the lead folds this into one generated migration.
CREATE TABLE IF NOT EXISTS "app_trip_facts" (
	"trip_id" uuid PRIMARY KEY NOT NULL REFERENCES "app_trips"("id") ON DELETE cascade,
	"agent_name" text DEFAULT 'Faisal' NOT NULL,
	"covering_name" text,
	"no_stay" jsonb,
	"company" jsonb,
	"rating" jsonb,
	"vouchers" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"bag_report" text,
	"rebooked" boolean DEFAULT false NOT NULL,
	"picks" text[] DEFAULT '{}'::text[] NOT NULL,
	"weather" jsonb,
	"disruption" jsonb,
	"stays" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"pickups" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"segments" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"discount" bigint DEFAULT 0 NOT NULL,
	"booked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "app_trip_charges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trip_id" uuid NOT NULL REFERENCES "app_trips"("id") ON DELETE cascade,
	"owner_id" uuid NOT NULL REFERENCES "app_users"("id") ON DELETE restrict,
	"payment_id" uuid REFERENCES "app_payments"("id") ON DELETE set null,
	"request_id" uuid REFERENCES "app_requests"("id") ON DELETE set null,
	"item" text NOT NULL,
	"title" text NOT NULL,
	"sub" text DEFAULT '' NOT NULL,
	"amount" bigint NOT NULL,
	"method" text NOT NULL,
	"label" text,
	"plan" text DEFAULT 'full' NOT NULL,
	"instalments" jsonb,
	"credit_used" bigint DEFAULT 0 NOT NULL,
	"discount" bigint DEFAULT 0 NOT NULL,
	"lines" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"invoice_id" uuid REFERENCES "app_invoices"("id") ON DELETE set null,
	"paid_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "app_trip_charges_trip_idx" ON "app_trip_charges" ("trip_id","paid_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "app_trip_charges_owner_idx" ON "app_trip_charges" ("owner_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "app_invoice_details" (
	"invoice_id" uuid PRIMARY KEY NOT NULL REFERENCES "app_invoices"("id") ON DELETE cascade,
	"charge_id" uuid REFERENCES "app_trip_charges"("id") ON DELETE set null,
	"kind" text NOT NULL,
	"status" text DEFAULT 'issued' NOT NULL,
	"customer" text NOT NULL,
	"company" jsonb,
	"against_invoice_id" uuid REFERENCES "app_invoices"("id") ON DELETE set null,
	"paid_with" text,
	"lines" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "app_invoice_details_charge_idx" ON "app_invoice_details" ("charge_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "app_invoice_counters" (
	"series" text PRIMARY KEY NOT NULL,
	"next" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "app_refund_groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL REFERENCES "app_users"("id") ON DELETE restrict,
	"trip_id" uuid REFERENCES "app_trips"("id") ON DELETE set null,
	"title" text NOT NULL,
	"amount" bigint NOT NULL,
	"stage" text DEFAULT 'requested' NOT NULL,
	"destination" text NOT NULL,
	"provider" text,
	"card" text NOT NULL,
	"reason" text,
	"anyway" boolean DEFAULT false NOT NULL,
	"reject" text,
	"alt" text,
	"law" boolean DEFAULT false NOT NULL,
	"airline" text,
	"cancelled_count" integer DEFAULT 0 NOT NULL,
	"cancelled_amount" bigint DEFAULT 0 NOT NULL,
	"expected_by" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"client_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "app_refund_groups_key" ON "app_refund_groups" ("owner_id","client_key");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "app_refund_groups_owner_idx" ON "app_refund_groups" ("owner_id","created_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "app_refund_items" (
	"refund_id" uuid PRIMARY KEY NOT NULL REFERENCES "app_refunds"("id") ON DELETE cascade,
	"group_id" uuid NOT NULL REFERENCES "app_refund_groups"("id") ON DELETE cascade,
	"charge_id" uuid NOT NULL REFERENCES "app_trip_charges"("id") ON DELETE restrict,
	"credited" bigint NOT NULL,
	"credit_note_id" uuid REFERENCES "app_invoices"("id") ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "app_refund_items_group_idx" ON "app_refund_items" ("group_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "app_refund_items_charge_idx" ON "app_refund_items" ("charge_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "app_trip_idempotency" (
	"owner_id" uuid NOT NULL REFERENCES "app_users"("id") ON DELETE cascade,
	"scope" text NOT NULL,
	"key" text NOT NULL,
	"result" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "app_trip_idempotency_pk" PRIMARY KEY ("owner_id","scope","key")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "app_tracked_extras" (
	"tracked_id" uuid PRIMARY KEY NOT NULL REFERENCES "app_tracked_flights"("id") ON DELETE cascade,
	"alerts" boolean DEFAULT false NOT NULL,
	"known" boolean DEFAULT false NOT NULL,
	"duration_min" integer,
	"brand" text,
	"last_alert_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "app_flight_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"flight_number" text NOT NULL,
	"day" date NOT NULL,
	"kind" text NOT NULL,
	"value" text,
	"source" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "app_flight_events_key" ON "app_flight_events" ("flight_number","day","kind","value");
