-- Cash custody. Cash sale receipts no longer land in a bank account: they are physically held by a staff
-- member. A cash payment stores account = 'cash' (so it never counts toward any bank balance) and
-- cash_holder = the person who received it, and it is auto-cleared on receipt (realised immediately).
-- The cash_ledger records what happens to that cash afterwards: handed to another person, deposited into a
-- company bank, or corrected. Cash on hand per person = their cash receipts + ledger in − ledger out.

ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "cash_holder" uuid REFERENCES "users"("id");
CREATE INDEX IF NOT EXISTS "payments_cash_holder_idx" ON "payments" ("cash_holder");

CREATE TABLE IF NOT EXISTS "cash_ledger" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "kind" text NOT NULL,
  "from_user" uuid REFERENCES "users"("id"),
  "to_user" uuid REFERENCES "users"("id"),
  "to_account" text,
  "amount" bigint NOT NULL,
  "note" text,
  "entry_date" date NOT NULL,
  "recorded_by" uuid NOT NULL REFERENCES "users"("id"),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "cash_ledger_from_idx" ON "cash_ledger" ("from_user");
CREATE INDEX IF NOT EXISTS "cash_ledger_to_idx" ON "cash_ledger" ("to_user");

-- Existing cash receipts were recorded against a bank account before cash custody existed. Leave those
-- historical rows as they are (they already cleared into a bank); cash custody applies to new cash receipts.
