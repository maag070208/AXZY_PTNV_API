-- Housekeeping operate permission (start, finish, extras). Roles are seeded at startup from role_permissions.json.
INSERT INTO "permissions" ("key", "module", "name", "description", "scopes", "sensitive", "active", "sortOrder", "updatedAt")
VALUES
  ('housekeeping.operate', 'Hotel', 'Operate housekeeping tasks', 'Start, finish and add extras to housekeeping tasks',
   ARRAY['OWN', 'AREA', 'ALL']::"PermissionScope"[], false, true, 917, CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;
