-- Mada Ops · one-time go-live reset
-- Clears ALL test data. Keeps: partner and staff logins, roles, partners (equity), bank accounts, settings.
-- Run once in Supabase → SQL Editor. Everyone is signed out and signs in again.
--
-- After running this, set each bank's REAL opening balance (see the block at the bottom).
BEGIN;

-- One TRUNCATE so the foreign keys between these tables don't block each other.
-- Every table that holds a transaction, a document about one, or a derived record is listed here.
TRUNCATE
  audit_events, attachments, remarks,
  settlement_cycles, bsp_obligations, bsp_closings,
  daily_closes, ledger_entries, expenses,
  approval_decisions, approval_requests,
  supplier_payments, bank_transactions,
  payments, bookings, clients, leads,
  delegations, sessions, counters, tasks
RESTART IDENTITY CASCADE;

-- The IATA reserve "held" came from test settlements; start from zero.
UPDATE settings SET value = '0'::jsonb, updated_at = now() WHERE key = 'iataReserveHeld';

-- The new log starts with one line saying what happened.
INSERT INTO audit_events (action, entity_type, summary)
VALUES ('system.reset', 'system', 'Test data cleared before go-live');

COMMIT;

-- ─────────────────────────────────────────────────────────────────────────
-- STEP 2 (run after the reset): set each bank's real opening balance.
-- Amounts are in halalas, so multiply SAR by 100 (e.g. 1,580.00 SAR → 158000).
-- Edit the two numbers below to the ACTUAL money in each bank right now, then run.
-- ─────────────────────────────────────────────────────────────────────────
-- UPDATE bank_accounts SET opening_balance = 0 WHERE key = 'retail';     -- SNB
-- UPDATE bank_accounts SET opening_balance = 0 WHERE key = 'corporate';  -- Alinma (B2B)
