-- Mada Ops · one-time go-live reset
-- Clears all test data. Keeps: partner and staff logins, roles, partners (equity), bank accounts, settings.
-- Run once in Supabase → SQL Editor. Everyone is signed out and signs in again.
BEGIN;

TRUNCATE
  audit_events, attachments, remarks,
  settlement_cycles, bsp_obligations, daily_closes,
  ledger_entries, expenses,
  approval_decisions, approval_requests,
  payments, bookings, clients,
  delegations, sessions, counters, tasks
RESTART IDENTITY;

-- The IATA reserve "held" came from test settlements; start from zero.
UPDATE settings SET value = '0'::jsonb, updated_at = now() WHERE key = 'iataReserveHeld';

-- The new log starts with one line saying what happened.
INSERT INTO audit_events (action, entity_type, summary)
VALUES ('system.reset', 'system', 'Test data cleared before go-live');

COMMIT;
