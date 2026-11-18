-- Permiso de la dotación por habitación (v3 F1): solo se sembraba desde seed-data; aquí queda en migración.
INSERT INTO "permissions" ("key", "module", "name", "description", "scopes", "sensitive", "active", "sortOrder", "updatedAt")
VALUES
  ('hotel_linen.room_par', 'Blancos', 'Room par', 'Edit the linen and amenities par per room component',
   ARRAY['NONE', 'AREA', 'ALL']::"PermissionScope"[], false, true, 1026, CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;

-- La supervisora de área lo tiene con alcance AREA: el catálogo debe admitirlo.
UPDATE "permissions"
SET "scopes" = ARRAY['NONE', 'AREA', 'ALL']::"PermissionScope"[], "updatedAt" = CURRENT_TIMESTAMP
WHERE "key" = 'hotel_linen.room_par' AND NOT ('AREA' = ANY ("scopes"));
