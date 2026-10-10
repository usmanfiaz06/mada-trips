-- The app's audit trail and the credit ledger are evidence: nobody, including the API, can edit or remove a row.
-- Corrections are new rows (a reversing ledger entry, a follow-up audit event).
CREATE OR REPLACE FUNCTION app_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER app_audit_no_update BEFORE UPDATE OR DELETE ON app_audit
  FOR EACH ROW EXECUTE FUNCTION app_append_only();
--> statement-breakpoint
CREATE TRIGGER app_credit_ledger_no_update BEFORE UPDATE OR DELETE ON app_credit_ledger
  FOR EACH ROW EXECUTE FUNCTION app_append_only();
