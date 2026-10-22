-- Permiso para escribir en el reloj (altas, cambios y bajas de personas y tarjetas,
-- y alta desde Personal). Mismo contenido que prisma/seed-data (permissions.json / role_permissions.json).
-- Sigue cubierto por time_clocks.manage para leer y administrar relojes.
INSERT INTO "permissions" ("key", "module", "name", "description", "scopes", "sensitive", "active", "sortOrder", "updatedAt")
VALUES ('time_clock.write', 'Checador', 'Escribir en el reloj',
        'Dar de alta, editar y dar de baja personas y tarjetas en el reloj, y dar de alta desde Personal. Solo el reloj de prueba acepta escritura desde la web.',
        ARRAY['NONE', 'ALL']::"PermissionScope"[], true, true, 4, CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "role_permissions" ("id", "role", "permission", "scope", "updatedAt")
VALUES ('role_permission_admin_time_clock_write', 'ADMIN', 'time_clock.write', 'ALL', CURRENT_TIMESTAMP),
       ('role_permission_hr_time_clock_write', 'HUMAN_RESOURCES', 'time_clock.write', 'ALL', CURRENT_TIMESTAMP)
ON CONFLICT ("role", "permission") DO NOTHING;
