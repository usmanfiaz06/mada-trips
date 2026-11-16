-- The portals.manage permission was added with the B2B portals feature, but roles already in the database
-- were created before it existed, so directors couldn't see the page. Grant it to the partner roles (who have
-- all finance permissions by default); directors can grant it to other roles from Roles & access.
UPDATE "roles" SET "permissions" = array_append("permissions", 'portals.manage')
  WHERE "key" IN ('partner', 'partner_issuer') AND NOT ('portals.manage' = ANY("permissions"));
