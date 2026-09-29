-- Permisos de facturas de proveedor de cocina (F4).
-- Mismo contenido que prisma/seed-data (permissions.json / role_permissions.json).
INSERT INTO "permissions" ("key", "module", "name", "description", "scopes", "sensitive", "active", "sortOrder", "updatedAt")
VALUES
  ('invoices.view', 'Compras de cocina', 'Ver facturas',
   'Consultar facturas de proveedor del almacén de cocina y su cotejo',
   ARRAY['NONE', 'ALL']::"PermissionScope"[], false, true, 4, CURRENT_TIMESTAMP),
  ('invoices.register', 'Compras de cocina', 'Registrar facturas',
   'Registrar y cancelar facturas de proveedor y actualizar el costo de los lotes',
   ARRAY['NONE', 'ALL']::"PermissionScope"[], false, true, 5, CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "role_permissions" ("id", "role", "permission", "scope", "updatedAt")
VALUES
  ('role_permission_chef_inv_view', 'CHEF', 'invoices.view', 'ALL', CURRENT_TIMESTAMP),
  ('role_permission_admin_inv_view', 'ADMIN', 'invoices.view', 'ALL', CURRENT_TIMESTAMP),
  ('role_permission_admin_inv_register', 'ADMIN', 'invoices.register', 'ALL', CURRENT_TIMESTAMP),
  ('role_permission_manager_inv_view', 'MANAGER', 'invoices.view', 'ALL', CURRENT_TIMESTAMP),
  ('role_permission_manager_inv_register', 'MANAGER', 'invoices.register', 'ALL', CURRENT_TIMESTAMP)
ON CONFLICT ("role", "permission") DO NOTHING;
