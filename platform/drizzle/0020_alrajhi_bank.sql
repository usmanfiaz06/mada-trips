-- Add the Alrajhi (B2C) bank account. Any can be used for any sale; balances are computed per account
-- from the existing payments / supplier payments / bank transactions, so no other data changes.
INSERT INTO "bank_accounts" ("key", "name", "bank", "iban", "opening_balance", "opening_date")
VALUES ('alrajhi', 'Alrajhi (B2C)', 'Al Rajhi Bank', NULL, 0, CURRENT_DATE)
ON CONFLICT ("key") DO NOTHING;
