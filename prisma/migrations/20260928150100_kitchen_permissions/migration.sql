-- Permisos del almacén de cocina y matriz del rol CHEF (tickets + cocina).
-- Mismo contenido que prisma/seed-data (permissions.json / role_permissions.json).
INSERT INTO "permissions" ("key", "module", "name", "description", "scopes", "sensitive", "active", "sortOrder", "updatedAt")
VALUES
  ('kitchen.view', 'Almacén de cocina', 'Ver almacén de cocina',
   'Consultar artículos, existencias por lote, kardex, reabastecimiento y alertas',
   ARRAY['NONE', 'ALL']::"PermissionScope"[], false, true, 1, CURRENT_TIMESTAMP),
  ('kitchen.manage', 'Almacén de cocina', 'Administrar catálogo de cocina',
   'Alta y edición de artículos (mínimos y máximos), categorías y proveedores',
   ARRAY['NONE', 'ALL']::"PermissionScope"[], false, true, 2, CURRENT_TIMESTAMP),
  ('kitchen.stock_in', 'Almacén de cocina', 'Registrar entradas de cocina',
   'Registrar entradas al almacén de cocina con lote y caducidad',
   ARRAY['NONE', 'ALL']::"PermissionScope"[], false, true, 3, CURRENT_TIMESTAMP),
  ('kitchen.stock_out', 'Almacén de cocina', 'Registrar consumos y mermas',
   'Registrar consumos (FEFO) y mermas del almacén de cocina',
   ARRAY['NONE', 'ALL']::"PermissionScope"[], false, true, 4, CURRENT_TIMESTAMP),
  ('kitchen.adjust', 'Almacén de cocina', 'Ajustes y reversiones de cocina',
   'Ajustar existencias por conteo físico y revertir movimientos del almacén de cocina',
   ARRAY['NONE', 'ALL']::"PermissionScope"[], true, true, 5, CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "role_permissions" ("id", "role", "permission", "scope", "updatedAt")
VALUES
  ('role_permission_chef_tickets_view', 'CHEF', 'tickets.view', 'AREA', CURRENT_TIMESTAMP),
  ('role_permission_chef_tickets_create', 'CHEF', 'tickets.create', 'ALL', CURRENT_TIMESTAMP),
  ('role_permission_chef_tickets_edit', 'CHEF', 'tickets.edit', 'OWN', CURRENT_TIMESTAMP),
  ('role_permission_chef_tickets_close', 'CHEF', 'tickets.close', 'AREA', CURRENT_TIMESTAMP),
  ('role_permission_chef_tasks_view', 'CHEF', 'tasks.view', 'OWN', CURRENT_TIMESTAMP),
  ('role_permission_chef_attendance_view', 'CHEF', 'attendance.view', 'OWN', CURRENT_TIMESTAMP),
  ('role_permission_chef_kitchen_view', 'CHEF', 'kitchen.view', 'ALL', CURRENT_TIMESTAMP),
  ('role_permission_chef_kitchen_manage', 'CHEF', 'kitchen.manage', 'ALL', CURRENT_TIMESTAMP),
  ('role_permission_chef_kitchen_stock_in', 'CHEF', 'kitchen.stock_in', 'ALL', CURRENT_TIMESTAMP),
  ('role_permission_chef_kitchen_stock_out', 'CHEF', 'kitchen.stock_out', 'ALL', CURRENT_TIMESTAMP),
  ('role_permission_chef_kitchen_adjust', 'CHEF', 'kitchen.adjust', 'ALL', CURRENT_TIMESTAMP),
  ('role_permission_admin_kitchen_view', 'ADMIN', 'kitchen.view', 'ALL', CURRENT_TIMESTAMP),
  ('role_permission_admin_kitchen_manage', 'ADMIN', 'kitchen.manage', 'ALL', CURRENT_TIMESTAMP),
  ('role_permission_admin_kitchen_stock_in', 'ADMIN', 'kitchen.stock_in', 'ALL', CURRENT_TIMESTAMP),
  ('role_permission_admin_kitchen_stock_out', 'ADMIN', 'kitchen.stock_out', 'ALL', CURRENT_TIMESTAMP),
  ('role_permission_admin_kitchen_adjust', 'ADMIN', 'kitchen.adjust', 'ALL', CURRENT_TIMESTAMP),
  ('role_permission_manager_kitchen_view', 'MANAGER', 'kitchen.view', 'ALL', CURRENT_TIMESTAMP)
ON CONFLICT ("role", "permission") DO NOTHING;
