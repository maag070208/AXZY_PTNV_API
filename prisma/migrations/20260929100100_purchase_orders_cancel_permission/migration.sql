-- Cancelar una orden de compra deja de depender de poder crearla: gerencia
-- puede cancelar sin crear. Mismo contenido que prisma/seed-data.
INSERT INTO "permissions" ("key", "module", "name", "description", "scopes", "sensitive", "active", "sortOrder", "updatedAt")
VALUES ('purchase_orders.cancel', 'Compras de cocina', 'Cancelar órdenes de compra',
        'Cancelar órdenes de compra que aún no tienen recepciones',
        ARRAY['NONE', 'ALL']::"PermissionScope"[], false, true, 4, CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "role_permissions" ("id", "role", "permission", "scope", "updatedAt")
VALUES ('role_permission_admin_purchase_orders_cancel', 'ADMIN', 'purchase_orders.cancel', 'ALL', CURRENT_TIMESTAMP),
       ('role_permission_manager_purchase_orders_cancel', 'MANAGER', 'purchase_orders.cancel', 'ALL', CURRENT_TIMESTAMP),
       ('role_permission_chef_purchase_orders_cancel', 'CHEF', 'purchase_orders.cancel', 'ALL', CURRENT_TIMESTAMP)
ON CONFLICT ("role", "permission") DO NOTHING;
