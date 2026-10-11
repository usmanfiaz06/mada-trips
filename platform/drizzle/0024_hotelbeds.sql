CREATE TABLE "app_hotelbeds_hotels" (
	"code" integer PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"category" text,
	"destination_code" text,
	"zone_code" integer,
	"address" text,
	"postal_code" text,
	"city" text,
	"latitude" double precision,
	"longitude" double precision,
	"phone" text,
	"description" text,
	"images" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"facilities" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"last_update" text,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app_supplier_bookings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"supplier" text NOT NULL,
	"product" text NOT NULL,
	"source_kind" text NOT NULL,
	"source_id" uuid NOT NULL,
	"owner_id" uuid,
	"rate_key" text NOT NULL,
	"client_reference" text NOT NULL,
	"status" text NOT NULL,
	"supplier_ref" text,
	"net" text,
	"currency" text,
	"sell" bigint,
	"environment" text NOT NULL,
	"mode" text NOT NULL,
	"problem" text,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"booked_by" text,
	"cancel_fee" text,
	"cancelled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "app_supplier_bookings" ADD CONSTRAINT "app_supplier_bookings_owner_id_app_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."app_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "app_hotelbeds_hotels_dest_idx" ON "app_hotelbeds_hotels" USING btree ("destination_code");--> statement-breakpoint
CREATE INDEX "app_supplier_bookings_source_idx" ON "app_supplier_bookings" USING btree ("source_kind","source_id");--> statement-breakpoint
CREATE UNIQUE INDEX "app_supplier_bookings_live_uq" ON "app_supplier_bookings" USING btree ("supplier","source_kind","source_id") WHERE status in ('booking','confirmed','unknown');