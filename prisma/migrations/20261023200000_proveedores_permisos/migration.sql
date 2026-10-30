-- Permisos del catálogo general de proveedores (/suppliers). Cocina conserva sus
-- rutas (alias) con kitchen.view / kitchen.manage. Roles: mismo alcance que cocina.
INSERT INTO "permissions" ("key", "module", "name", "description", "scopes", "sensitive", "active", "sortOrder", "updatedAt")
VALUES
  ('suppliers.view', 'Proveedores', 'Ver proveedores', 'Consultar el catálogo general de proveedores y sus categorías',
   ARRAY['NONE', 'ALL']::"PermissionScope"[], false, true, 907, CURRENT_TIMESTAMP),
  ('suppliers.manage', 'Proveedores', 'Administrar proveedores', 'Alta y edición de proveedores, contactos y categorías',
   ARRAY['NONE', 'ALL']::"PermissionScope"[], false, true, 908, CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "role_permissions" ("id", "role", "permission", "scope", "updatedAt")
VALUES
  ('role_permission_chef_suppliers_view', 'CHEF', 'suppliers.view', 'ALL', CURRENT_TIMESTAMP),
  ('role_permission_admin_suppliers_view', 'ADMIN', 'suppliers.view', 'ALL', CURRENT_TIMESTAMP),
  ('role_permission_manager_suppliers_view', 'MANAGER', 'suppliers.view', 'ALL', CURRENT_TIMESTAMP),
  ('role_permission_chef_suppliers_manage', 'CHEF', 'suppliers.manage', 'ALL', CURRENT_TIMESTAMP),
  ('role_permission_admin_suppliers_manage', 'ADMIN', 'suppliers.manage', 'ALL', CURRENT_TIMESTAMP)
ON CONFLICT ("role", "permission") DO NOTHING;
