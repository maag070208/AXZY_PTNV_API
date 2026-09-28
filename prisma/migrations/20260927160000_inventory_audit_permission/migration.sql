-- Permiso de la auditoría de inventario (GET /inventory/audit y sus avisos).
-- Mismo contenido que prisma/seed-data (permissions.json / role_permissions.json).
INSERT INTO "permissions" ("key", "module", "name", "description", "scopes", "sensitive", "active", "sortOrder", "updatedAt")
VALUES ('inventory.audit', 'Inventario', 'Auditar inventario',
        'Ver la auditoría de consistencia del inventario (préstamos, unidades y kardex) y recibir sus avisos',
        ARRAY['NONE', 'ALL']::"PermissionScope"[], false, true, 5, CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "role_permissions" ("id", "role", "permission", "scope", "updatedAt")
VALUES ('role_permission_admin_inventory_audit', 'ADMIN', 'inventory.audit', 'ALL', CURRENT_TIMESTAMP),
       ('role_permission_manager_inventory_audit', 'MANAGER', 'inventory.audit', 'ALL', CURRENT_TIMESTAMP)
ON CONFLICT ("role", "permission") DO NOTHING;
