-- Commission payouts: a partner enables commission per team member, works it out in the calculator, and pays
-- it via a director-approved payout from a company bank. Every covered sale is stamped so it's never paid twice.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "commission_enabled" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "commission_basis" text DEFAULT 'profit' NOT NULL;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "commission_from" date;
--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "commission_payment_id" uuid;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "commission_payments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "ref" text NOT NULL,
  "member_id" uuid NOT NULL REFERENCES "users"("id"),
  "period_start" date NOT NULL,
  "period_end" date NOT NULL,
  "basis" text NOT NULL,
  "rate_bps" integer NOT NULL,
  "base_amount" bigint NOT NULL,
  "amount" bigint NOT NULL,
  "sales_count" integer DEFAULT 0 NOT NULL,
  "account" text,
  "status" text DEFAULT 'pending_approval' NOT NULL,
  "approval_id" uuid,
  "note" text,
  "requested_by" uuid NOT NULL REFERENCES "users"("id"),
  "paid_on" date,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "commission_payments_ref_unique" UNIQUE("ref")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "commission_payments_member_idx" ON "commission_payments" ("member_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "commission_payments_status_idx" ON "commission_payments" ("status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bookings_commission_payment_idx" ON "bookings" ("commission_payment_id");
