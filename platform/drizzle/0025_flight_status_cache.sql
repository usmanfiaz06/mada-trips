CREATE TABLE "app_flight_status_cache" (
	"vendor" text NOT NULL,
	"flight_number" text NOT NULL,
	"day" date NOT NULL,
	"found" boolean NOT NULL,
	"info" jsonb,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "app_flight_status_cache_vendor_flight_number_day_pk" PRIMARY KEY("vendor","flight_number","day")
);
--> statement-breakpoint
CREATE TABLE "app_supplier_usage" (
	"vendor" text NOT NULL,
	"month" text NOT NULL,
	"used" integer DEFAULT 0 NOT NULL,
	"calls" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "app_supplier_usage_vendor_month_pk" PRIMARY KEY("vendor","month")
);
