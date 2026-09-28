-- Permiso del reporte semanal de asistencia para nómina
-- (POST /schedules/weekly-attendance y la pantalla Nómina).
-- Mismo contenido que prisma/seed-data (permissions.json / role_permissions.json).
INSERT INTO "permissions" ("key", "module", "name", "description", "scopes", "sensitive", "active", "sortOrder", "updatedAt")
VALUES ('payroll.view', 'Nómina', 'Ver nómina',
        'Consultar y exportar la asistencia semanal para nómina',
        ARRAY['NONE', 'ALL']::"PermissionScope"[], false, true, 1, CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "role_permissions" ("id", "role", "permission", "scope", "updatedAt")
VALUES ('role_permission_admin_payroll_view', 'ADMIN', 'payroll.view', 'ALL', CURRENT_TIMESTAMP),
       ('role_permission_hr_payroll_view', 'HUMAN_RESOURCES', 'payroll.view', 'ALL', CURRENT_TIMESTAMP)
ON CONFLICT ("role", "permission") DO NOTHING;
