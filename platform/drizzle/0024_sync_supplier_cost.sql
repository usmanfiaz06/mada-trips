-- One-time reconciliation. Correcting an issued sale's cost used to update the booking but not the supplier
-- payment that was already recorded against it — so the bank's cash (which sums supplier_payments.amount)
-- and any partner who fronted the cost stayed on the old figure. The code now keeps them in sync on every
-- correction; this backfills rows that already drifted. Every live supplier payment is the full booking cost
-- (recordSupplierPayment records net_cost and blocks a second payment), so matching it to net_cost is safe.
UPDATE "supplier_payments" sp
SET "amount" = b."net_cost"
FROM "bookings" b
WHERE sp."booking_id" = b."id"
  AND sp."status" IN ('settled', 'pending_approval')
  AND sp."amount" <> b."net_cost";
--> statement-breakpoint
-- Partner-fronted costs already posted to the partner ledger drifted the same way.
UPDATE "ledger_entries" le
SET "amount" = b."net_cost"
FROM "supplier_payments" sp
JOIN "bookings" b ON b."id" = sp."booking_id"
WHERE le."source_type" = 'supplier'
  AND le."source_id" = sp."booking_id"
  AND le."type" = 'expense'
  AND sp."source" = 'partner'
  AND sp."status" = 'settled'
  AND le."amount" <> b."net_cost";
--> statement-breakpoint
-- Keep the amount on any still-pending partner supplier approval honest too.
UPDATE "approval_requests" ar
SET "amount" = b."net_cost"
FROM "supplier_payments" sp
JOIN "bookings" b ON b."id" = sp."booking_id"
WHERE ar."id" = sp."approval_id"
  AND sp."status" = 'pending_approval'
  AND ar."status" = 'pending'
  AND ar."amount" <> b."net_cost";
