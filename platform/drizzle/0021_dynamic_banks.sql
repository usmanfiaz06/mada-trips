-- Bank accounts become fully data-driven: add a sort column, give the existing accounts their order and
-- full display names, and add the Alrajhi (B2B) account. New accounts are added from Banks & cash (no code).
ALTER TABLE "bank_accounts" ADD COLUMN IF NOT EXISTS "sort" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
UPDATE "bank_accounts" SET "sort" = 0 WHERE "key" = 'retail';
--> statement-breakpoint
UPDATE "bank_accounts" SET "sort" = 1 WHERE "key" = 'alrajhi';
--> statement-breakpoint
UPDATE "bank_accounts" SET "sort" = 2, "name" = 'Alinma (B2B Account)' WHERE "key" = 'corporate';
--> statement-breakpoint
INSERT INTO "bank_accounts" ("key", "name", "bank", "iban", "opening_balance", "opening_date", "sort")
VALUES ('alrajhi_b2b', 'Alrajhi (B2B)', 'Al Rajhi Bank', NULL, 0, CURRENT_DATE, 3)
ON CONFLICT ("key") DO NOTHING;
