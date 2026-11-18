-- Blancos v3 F5: alcance por puesto. Solo cambia la matriz rol -> permiso (el catálogo de permisos no cambia).

-- La Supervisora de área recibe su entrega de amenidades (AMENITY_DELIVERY).
INSERT INTO "role_permissions" ("id", "role", "permission", "scope", "updatedAt")
SELECT gen_random_uuid()::text, 'HOUSEKEEPING_SUPERVISOR', 'hotel_linen.transfer_receive', 'AREA'::"PermissionScope", CURRENT_TIMESTAMP
WHERE EXISTS (SELECT 1 FROM "roles" WHERE "key" = 'HOUSEKEEPING_SUPERVISOR')
  AND EXISTS (SELECT 1 FROM "permissions" WHERE "key" = 'hotel_linen.transfer_receive')
ON CONFLICT ("role", "permission") DO NOTHING;

-- Lavandería ya no cuenta: el conteo de su resguardo lo hace la supervisión.
DELETE FROM "role_permissions" WHERE "role" = 'HOTEL_LAUNDRY' AND "permission" = 'hotel_linen.count';
