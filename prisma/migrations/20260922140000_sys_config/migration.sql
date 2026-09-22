-- Configuración del sistema editable por ADMIN desde el panel de catálogos.
-- Permite mover valores que antes vivían en `process.env` a una tabla
-- gestionable en tiempo de ejecución, con auditoría (AuditLog).

CREATE TABLE "sys_config" (
  "id" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "value" TEXT NOT NULL,
  "descripcion" TEXT,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "updatedById" TEXT,
  CONSTRAINT "sys_config_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "sys_config_key_key" ON "sys_config"("key");
CREATE INDEX "sys_config_updatedAt_idx" ON "sys_config"("updatedAt" DESC);

ALTER TABLE "sys_config"
  ADD CONSTRAINT "sys_config_updatedById_fkey"
  FOREIGN KEY ("updatedById") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Seed inicial: recipients de notificaciones del sistema (comas).
-- Idempotente: si la fila ya existe (migración previa, hot-fix, etc.),
-- conserva el valor actual. Empieza vacía; el boot hook del API lo
-- siembra con `NOTIFICATION_EMAILS` si existe en env la primera vez.
INSERT INTO "sys_config" ("id", "key", "value", "descripcion", "updatedAt")
VALUES (
  'sys_config_notification_recipients',
  'EMAIL_NOTIFICATION_RECIPIENTS',
  '',
  'Destinatarios copias en notificaciones de sistema (separados por coma)',
  now()
)
ON CONFLICT ("key") DO NOTHING;