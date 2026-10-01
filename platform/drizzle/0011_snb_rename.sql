-- The retail/B2C account is Saudi National Bank (Al Ahli), not Al Rajhi.
UPDATE "bank_accounts" SET "name" = 'SNB', "bank" = 'Saudi National Bank (Al Ahli)'
  WHERE "key" = 'retail' AND "name" IN ('Al Rajhi', 'Retail / B2C');
