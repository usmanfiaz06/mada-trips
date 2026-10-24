-- Mada's rule: Haneef and Abdulaziz are never shown to a client. Add them to every workspace already open.
UPDATE "clients"
SET "hidden_names" = ARRAY(SELECT DISTINCT unnest("hidden_names" || ARRAY['Haneef', 'Abdulaziz']::text[]))
WHERE "portal_enabled" = true;
