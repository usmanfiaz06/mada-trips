ALTER TABLE "bookings" ADD COLUMN "supplier_paid" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE TABLE "supplier_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"booking_id" uuid NOT NULL,
	"supplier" text NOT NULL,
	"amount" bigint NOT NULL,
	"source" text NOT NULL,
	"account" text,
	"partner_id" uuid,
	"method" text DEFAULT 'transfer' NOT NULL,
	"status" text DEFAULT 'settled' NOT NULL,
	"approval_id" uuid,
	"reference" text,
	"paid_on" date NOT NULL,
	"recorded_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_recorded_by_users_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "supplier_payments_booking_idx" ON "supplier_payments" USING btree ("booking_id");--> statement-breakpoint
CREATE INDEX "supplier_payments_account_idx" ON "supplier_payments" USING btree ("account");--> statement-breakpoint
ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_amount_ok" CHECK ("amount" > 0) NOT VALID;--> statement-breakpoint
-- Existing bookings: assume prior supplier costs were already handled, so they don't all show as owed.
UPDATE "bookings" SET "supplier_paid" = true WHERE "status" IN ('issued','void','refunded');
