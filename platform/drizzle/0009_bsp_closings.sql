ALTER TABLE "bookings" ADD COLUMN "via_bsp" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "bsp_closing_id" uuid;--> statement-breakpoint
CREATE TABLE "bsp_closings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"due_date" date NOT NULL,
	"amount" bigint NOT NULL,
	"status" text DEFAULT 'pending_approval' NOT NULL,
	"source" text NOT NULL,
	"account" text,
	"partner_id" uuid,
	"approval_id" uuid,
	"reference" text,
	"paid_on" date,
	"settled_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "bsp_closings" ADD CONSTRAINT "bsp_closings_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bsp_closings" ADD CONSTRAINT "bsp_closings_settled_by_users_id_fk" FOREIGN KEY ("settled_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bsp_closings_period_idx" ON "bsp_closings" USING btree ("period_end");--> statement-breakpoint
ALTER TABLE "bsp_closings" ADD CONSTRAINT "bsp_closing_amount_ok" CHECK ("amount" > 0) NOT VALID;--> statement-breakpoint
-- Flights already issued are BSP-settled through IATA; mark them so they don't show as individual airline payables.
UPDATE "bookings" SET "via_bsp" = true WHERE "service_type" = 'flight';
