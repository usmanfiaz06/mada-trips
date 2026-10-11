CREATE TABLE "app_flight_subscriptions" (
	"vendor" text NOT NULL,
	"flight_number" text NOT NULL,
	"subscription_id" text,
	"status" text NOT NULL,
	"error" text,
	"last_event_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "app_flight_subscriptions_vendor_flight_number_pk" PRIMARY KEY("vendor","flight_number")
);
