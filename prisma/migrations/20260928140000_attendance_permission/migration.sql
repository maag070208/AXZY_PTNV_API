-- Permiso de asistencia (entradas, salidas, faltas y retardos): el empleado ve
-- la suya, el jefe de área la de su departamento, RH/gerencia/admin la de todos.
-- Mismo contenido que prisma/seed-data (permissions.json / role_permissions.json).
INSERT INTO "permissions" ("key", "module", "name", "description", "scopes", "sensitive", "active", "sortOrder", "updatedAt")
VALUES ('attendance.view', 'Asistencia', 'Ver asistencia',
        'Consultar entradas, salidas, faltas y retardos (propia, de su área o de todos)',
        ARRAY['NONE', 'OWN', 'AREA', 'ALL']::"PermissionScope"[], false, true, 1, CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "role_permissions" ("id", "role", "permission", "scope", "updatedAt")
VALUES ('role_permission_admin_attendance_view', 'ADMIN', 'attendance.view', 'ALL', CURRENT_TIMESTAMP),
       ('role_permission_manager_attendance_view', 'MANAGER', 'attendance.view', 'ALL', CURRENT_TIMESTAMP),
       ('role_permission_hr_attendance_view', 'HUMAN_RESOURCES', 'attendance.view', 'ALL', CURRENT_TIMESTAMP),
       ('role_permission_area_head_attendance_view', 'AREA_HEAD', 'attendance.view', 'AREA', CURRENT_TIMESTAMP),
       ('role_permission_employee_attendance_view', 'EMPLOYEE', 'attendance.view', 'OWN', CURRENT_TIMESTAMP)
ON CONFLICT ("role", "permission") DO NOTHING;
