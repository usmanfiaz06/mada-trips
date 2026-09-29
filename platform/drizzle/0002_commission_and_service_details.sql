ALTER TABLE "bookings" ADD COLUMN "details" jsonb;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "commission_bps" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "commission_bps" integer DEFAULT 0 NOT NULL;