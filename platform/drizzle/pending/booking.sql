-- Booking (src/db/app-schema-booking.ts). Pending: the lead folds this into one generated migration.
CREATE TABLE IF NOT EXISTS "app_offers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL REFERENCES "app_users"("id") ON DELETE cascade,
	"kind" text NOT NULL,
	"supplier" text NOT NULL,
	"supplier_offer_id" text NOT NULL,
	"search" jsonb NOT NULL,
	"payload" jsonb NOT NULL,
	"total" bigint NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "app_offers_owner_idx" ON "app_offers" ("owner_id","created_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "app_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL REFERENCES "app_users"("id") ON DELETE restrict,
	"kind" text NOT NULL,
	"status" text NOT NULL,
	"step" integer DEFAULT 0 NOT NULL,
	"idempotency_key" text NOT NULL,
	"draft" jsonb NOT NULL,
	"snapshot" jsonb NOT NULL,
	"lines" jsonb NOT NULL,
	"traveller_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"subtotal" bigint NOT NULL,
	"discount" bigint DEFAULT 0 NOT NULL,
	"promo" text,
	"credit_used" bigint DEFAULT 0 NOT NULL,
	"total" bigint NOT NULL,
	"extra" bigint DEFAULT 0 NOT NULL,
	"plan" text DEFAULT 'full' NOT NULL,
	"payment_label" text NOT NULL,
	"payment_method" jsonb NOT NULL,
	"payment_id" uuid REFERENCES "app_payments"("id") ON DELETE set null,
	"request_id" uuid REFERENCES "app_requests"("id") ON DELETE set null,
	"trip_id" uuid REFERENCES "app_trips"("id") ON DELETE set null,
	"ref" text,
	"supplier_ref" text,
	"agent_name" text,
	"confirmed_by_name" text,
	"question" jsonb,
	"fare_change" jsonb,
	"problem" text,
	"otp_tries" integer DEFAULT 0 NOT NULL,
	"demo" text[] DEFAULT '{}'::text[] NOT NULL,
	"autopilot_at" timestamp with time zone,
	"autopilot_done" text[] DEFAULT '{}'::text[] NOT NULL,
	"confirmed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "app_orders_idem_key" ON "app_orders" ("owner_id","idempotency_key");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "app_orders_owner_idx" ON "app_orders" ("owner_id","created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "app_orders_status_idx" ON "app_orders" ("status","created_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "app_order_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL REFERENCES "app_orders"("id") ON DELETE cascade,
	"kind" text NOT NULL,
	"actor_kind" text NOT NULL,
	"actor_name" text,
	"data" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "app_order_events_order_idx" ON "app_order_events" ("order_id","created_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "app_trip_bookings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trip_id" uuid NOT NULL REFERENCES "app_trips"("id") ON DELETE cascade,
	"order_id" uuid NOT NULL REFERENCES "app_orders"("id") ON DELETE restrict,
	"ref" text NOT NULL,
	"lines" jsonb NOT NULL,
	"paid" jsonb NOT NULL,
	"pay_plan" text DEFAULT 'full' NOT NULL,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"booked_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "app_trip_bookings_trip_idx" ON "app_trip_bookings" ("trip_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "app_trip_bookings_order_key" ON "app_trip_bookings" ("order_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "app_payment_webhooks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"event_id" text NOT NULL,
	"type" text NOT NULL,
	"provider_ref" text NOT NULL,
	"payload_sha256" text NOT NULL,
	"result" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "app_payment_webhooks_event_key" ON "app_payment_webhooks" ("provider","event_id");
