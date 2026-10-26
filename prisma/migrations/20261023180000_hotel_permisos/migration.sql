-- Catálogo de permisos del almacén del hotel y de limpieza (F1).
-- Mismo contenido que prisma/seed-data/permissions.json. Las filas de roles
-- (role_permissions) las siembra el arranque desde los fixtures: GERENCIA y
-- HOTEL_STORE no existen en las migraciones.
INSERT INTO "permissions" ("key", "module", "name", "description", "scopes", "sensitive", "active", "sortOrder", "updatedAt")
VALUES
  ('hotel_rooms.view', 'Hotel', 'Ver zonas y habitaciones', 'Zonas, tipos y habitaciones (lectura)', ARRAY['OWN', 'AREA', 'ALL']::"PermissionScope"[], false, true, 901, CURRENT_TIMESTAMP),
  ('hotel_rooms.manage', 'Hotel', 'Administrar zonas y habitaciones', 'Zonas, tipos, habitaciones y kits', ARRAY['ALL']::"PermissionScope"[], false, true, 902, CURRENT_TIMESTAMP),
  ('hotel_rooms.status', 'Hotel', 'Cambiar estado de habitación', 'Cambiar el estado según la matriz de transiciones', ARRAY['OWN', 'AREA', 'ALL']::"PermissionScope"[], false, true, 903, CURRENT_TIMESTAMP),
  ('housekeeping.assign', 'Hotel', 'Asignar tareas y zonas', 'Asignar tareas de limpieza y supervisores de zona', ARRAY['AREA', 'ALL']::"PermissionScope"[], false, true, 904, CURRENT_TIMESTAMP),
  ('housekeeping.inspect', 'Hotel', 'Inspeccionar habitaciones', 'Aprobar o rechazar inspecciones de limpieza', ARRAY['AREA', 'ALL']::"PermissionScope"[], false, true, 905, CURRENT_TIMESTAMP),
  ('hotel_store.manage', 'Hotel', 'Administrar almacén del hotel', 'Productos, unidades, categorías, almacenes, ubicaciones y motivos', ARRAY['AREA', 'ALL']::"PermissionScope"[], false, true, 906, CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;
