-- B2B supplier portals (TBO, iTrip, …): an account-like balance held with a platform, funded by deposits or
-- a credit line, drawn by sales, topped back by refunds. Balance is always derived from these rows, never stored.
CREATE TABLE IF NOT EXISTS "portals" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "name" text NOT NULL,
  "credit_limit" bigint DEFAULT 0 NOT NULL,
  "active" boolean DEFAULT true NOT NULL,
  "notes" text,
  "sort" integer DEFAULT 0 NOT NULL,
  "created_by" uuid NOT NULL REFERENCES "users"("id"),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "portal_ledger" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "portal_id" uuid NOT NULL REFERENCES "portals"("id"),
  "kind" text NOT NULL,
  "direction" text NOT NULL,
  "amount" bigint NOT NULL,
  "source" text,
  "account" text,
  "partner_id" uuid REFERENCES "partners"("id"),
  "booking_id" uuid REFERENCES "bookings"("id"),
  "status" text DEFAULT 'settled' NOT NULL,
  "approval_id" uuid,
  "reference" text,
  "note" text,
  "entry_date" date NOT NULL,
  "recorded_by" uuid NOT NULL REFERENCES "users"("id"),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "portal_ledger_portal_idx" ON "portal_ledger" ("portal_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "portal_ledger_status_idx" ON "portal_ledger" ("status");
--> statement-breakpoint
-- A sale's cost can now be settled from a portal's balance, not just a bank or a partner's cash.
ALTER TABLE "supplier_payments" ADD COLUMN IF NOT EXISTS "portal_id" uuid REFERENCES "portals"("id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "supplier_payments_portal_idx" ON "supplier_payments" ("portal_id");
