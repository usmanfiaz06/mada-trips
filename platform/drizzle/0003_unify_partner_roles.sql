-- All three partners get the same access ("Partner"). The issuing partner keeps ticket issuing (TTP) as
-- "Partner · Issuing authority". Runs only on installs that still have the old Chairman/CEO/Director roles;
-- new installs get the new roles from the seed.
DO $$
DECLARE
  all_perms text[] := ARRAY['sales.create','sales.view_all','sales.edit','issue.unlimited','issue.delegate','clients.manage','clients.credit','approvals.decide','expenses.create','expenses.view_all','expenses.verify','close.submit','close.verify','finance.view','finance.reconcile','settlement.run','ledger.view_all','ledger.manage','team.manage','roles.manage','activity.view','settings.manage'];
  partner_perms text[] := array_remove(array_remove(all_perms, 'issue.unlimited'), 'issue.delegate');
  moved text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM roles WHERE key IN ('chairman', 'director', 'ceo')) THEN
    RETURN;
  END IF;

  INSERT INTO roles (key, name, name_ar, description, permissions, is_system)
  VALUES ('partner', 'Partner', 'شريك', 'Full access: team, roles, approvals, finance, settlement and settings.', partner_perms, true)
  ON CONFLICT (key) DO UPDATE SET permissions = EXCLUDED.permissions, name = EXCLUDED.name, name_ar = EXCLUDED.name_ar, description = EXCLUDED.description;

  UPDATE roles SET key = 'partner_issuer', name = 'Partner · Issuing authority', name_ar = 'شريك · صلاحية الإصدار',
    description = 'Full partner access, plus ticket issuing (TTP) and delegating it to staff.', permissions = all_perms
  WHERE key = 'ceo';

  SELECT string_agg(u.name, ', ') INTO moved FROM users u JOIN roles r ON r.id = u.role_id WHERE r.key IN ('chairman', 'director');
  UPDATE users SET role_id = (SELECT id FROM roles WHERE key = 'partner')
  WHERE role_id IN (SELECT id FROM roles WHERE key IN ('chairman', 'director'));

  DELETE FROM roles r WHERE r.key IN ('chairman', 'director') AND NOT EXISTS (SELECT 1 FROM users u WHERE u.role_id = r.id);

  INSERT INTO audit_events (actor_id, action, entity_type, entity_ref, summary)
  VALUES (NULL, 'role.updated', 'role', 'Partner',
    'Partner access unified: ' || coalesce(moved, 'partners') || ' moved to the Partner role (full access); the issuing partner''s role renamed to Partner · Issuing authority');
END $$;
