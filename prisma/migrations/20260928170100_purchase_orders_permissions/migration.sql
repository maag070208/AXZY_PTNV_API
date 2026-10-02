-- Permisos de órdenes de compra de cocina (F3).
-- Mismo contenido que prisma/seed-data (permissions.json / role_permissions.json).
INSERT INTO "permissions" ("key", "module", "name", "description", "scopes", "sensitive", "active", "sortOrder", "updatedAt")
VALUES
  ('purchase_orders.view', 'Compras de cocina', 'Ver órdenes de compra',
   'Consultar órdenes de compra del almacén de cocina',
   ARRAY['NONE', 'ALL']::"PermissionScope"[], false, true, 1, CURRENT_TIMESTAMP),
  ('purchase_orders.create', 'Compras de cocina', 'Crear órdenes de compra',
   'Crear, editar (en borrador) y enviar órdenes de compra',
   ARRAY['NONE', 'ALL']::"PermissionScope"[], false, true, 2, CURRENT_TIMESTAMP),
  ('purchase_orders.approve', 'Compras de cocina', 'Aprobar órdenes de compra',
   'Aprobar o cancelar órdenes de compra',
   ARRAY['NONE', 'ALL']::"PermissionScope"[], false, true, 3, CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "role_permissions" ("id", "role", "permission", "scope", "updatedAt")
VALUES
  ('role_permission_chef_po_view', 'CHEF', 'purchase_orders.view', 'ALL', CURRENT_TIMESTAMP),
  ('role_permission_chef_po_create', 'CHEF', 'purchase_orders.create', 'ALL', CURRENT_TIMESTAMP),
  ('role_permission_admin_po_view', 'ADMIN', 'purchase_orders.view', 'ALL', CURRENT_TIMESTAMP),
  ('role_permission_admin_po_create', 'ADMIN', 'purchase_orders.create', 'ALL', CURRENT_TIMESTAMP),
  ('role_permission_admin_po_approve', 'ADMIN', 'purchase_orders.approve', 'ALL', CURRENT_TIMESTAMP),
  ('role_permission_manager_po_view', 'MANAGER', 'purchase_orders.view', 'ALL', CURRENT_TIMESTAMP),
  ('role_permission_manager_po_approve', 'MANAGER', 'purchase_orders.approve', 'ALL', CURRENT_TIMESTAMP)
ON CONFLICT ("role", "permission") DO NOTHING;
