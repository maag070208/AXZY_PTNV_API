-- Vigencia por defecto de las excepciones de permiso (Fase 2). En días; 0 = sin
-- vencimiento. Se edita con `system.configure`.
INSERT INTO "sys_config" ("id", "key", "value", "description", "updatedAt")
VALUES ('sys_config_permission_exception_days', 'PERMISOS_EXCEPCION_DIAS', '30', 'Días que dura una excepción de permiso nueva cuando no se indica fecha. 0 = sin vencimiento.', now())
ON CONFLICT ("key") DO NOTHING;
