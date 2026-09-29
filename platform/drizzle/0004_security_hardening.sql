ALTER TABLE "approval_requests" ADD COLUMN "payload" jsonb;--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN "recognized_cycle_id" uuid;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "must_change_password" boolean DEFAULT false NOT NULL;--> statement-breakpoint
-- Expenses already counted by a signed Day-25 cycle are marked, so the new "sweep everything not yet counted" rule never counts them twice.
UPDATE "expenses" e SET "recognized_cycle_id" = c."id"
  FROM "settlement_cycles" c
  WHERE c."status" IN ('approved', 'paid') AND e."status" = 'approved' AND e."is_startup" = false
    AND e."expense_date" BETWEEN c."start_date" AND c."end_date" AND e."recognized_cycle_id" IS NULL;--> statement-breakpoint
-- One login per partner. If a partner somehow has several, the oldest keeps the link and the others are unlinked (and logged).
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT u."id", u."name" FROM "users" u
    WHERE u."partner_id" IS NOT NULL AND u."id" <> (
      SELECT u2."id" FROM "users" u2 WHERE u2."partner_id" = u."partner_id" ORDER BY u2."active" DESC, u2."created_at" ASC LIMIT 1)
  LOOP
    UPDATE "users" SET "partner_id" = NULL WHERE "id" = r."id";
    INSERT INTO "audit_events" ("action", "entity_type", "entity_id", "entity_ref", "summary")
      VALUES ('user.partner_unlinked', 'user', r."id", r."name", 'Unlinked ' || r."name" || ' from their partner: each partner has one login');
  END LOOP;
END $$;--> statement-breakpoint
CREATE UNIQUE INDEX "users_one_per_partner" ON "users" USING btree ("partner_id") WHERE "users"."partner_id" IS NOT NULL;--> statement-breakpoint
-- Money sanity at the database level (new rows; NOT VALID leaves any historic row alone).
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_money_ok" CHECK ("net_cost" >= 0 AND "sell_price" > 0 AND "vat_amount" >= 0 AND "commission_bps" BETWEEN 0 AND 5000) NOT VALID;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_amount_ok" CHECK ("amount" > 0) NOT VALID;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_money_ok" CHECK ("amount" > 0 AND "vat_amount" >= 0 AND "vat_amount" <= "amount") NOT VALID;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_amount_ok" CHECK ("amount" >= 0) NOT VALID;--> statement-breakpoint
ALTER TABLE "delegations" ADD CONSTRAINT "delegations_limits_ok" CHECK ("max_ticket" > 0 AND "daily_cap" >= "max_ticket") NOT VALID;--> statement-breakpoint
ALTER TABLE "clients" ADD CONSTRAINT "clients_terms_ok" CHECK ("credit_limit" >= 0 AND "payment_terms_days" BETWEEN 0 AND 180) NOT VALID;--> statement-breakpoint
ALTER TABLE "bsp_obligations" ADD CONSTRAINT "bsp_amount_ok" CHECK ("amount" > 0) NOT VALID;
--> statement-breakpoint
-- Anyone who has never chosen their own password (still on the shared first password, or a temporary one) picks one at next sign-in.
UPDATE "users" SET "must_change_password" = true
  WHERE NOT EXISTS (SELECT 1 FROM "audit_events" a WHERE a."action" = 'user.password_changed' AND a."entity_id" = "users"."id"::text);
