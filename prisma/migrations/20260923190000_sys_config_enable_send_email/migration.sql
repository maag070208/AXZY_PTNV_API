-- Interruptor global de correo transaccional, editable por ADMIN desde
-- /catalogos → Notificaciones. Default "true" (habilitado): la convención
-- del sistema es "key ausente = habilitado", así que esta fila solo
-- materializa el valor por defecto para que sea visible y editable.
-- Idempotente: si la fila ya existe, conserva el valor actual.
INSERT INTO "sys_config" ("id", "key", "value", "descripcion", "updatedAt")
VALUES (
  'sys_config_enable_send_email',
  'ENABLE_SEND_EMAIL',
  'true',
  'Habilita el envío de correos transaccionales del sistema (true/false)',
  now()
)
ON CONFLICT ("key") DO NOTHING;
