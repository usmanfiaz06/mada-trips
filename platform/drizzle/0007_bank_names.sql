-- The two accounts are the company's two banks, either usable for any sale.
UPDATE "bank_accounts" SET "name" = 'Al Rajhi', "bank" = 'Al Rajhi Bank' WHERE "key" = 'retail';--> statement-breakpoint
UPDATE "bank_accounts" SET "name" = 'Alinma', "bank" = COALESCE(NULLIF("bank", 'Saudi National Bank'), 'Alinma Bank') WHERE "key" = 'corporate';
