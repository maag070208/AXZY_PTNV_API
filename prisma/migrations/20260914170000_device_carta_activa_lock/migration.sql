-- Candado estructural de préstamo único: un dispositivo solo puede estar en
-- UNA carta vigente (sin devolución) a la vez, blindado por UNIQUE en BD.

-- 1. Columna nullable (sin default: solo dispositivos prestados la apuntan).
ALTER TABLE "devices" ADD COLUMN "cartaActivaId" TEXT;

-- 2. Backfill: los dispositivos ASIGNADOS actuales apuntan a la carta vigente
-- más reciente que los tiene. Si el dispositivo estuviera en 2+ cartas activas
-- solo se toma la más reciente; la UNIQUE garantiza solo un préstamo actual.
UPDATE "devices" d
SET "cartaActivaId" = sub."cartaId"
FROM (
  SELECT DISTINCT ON (ci."deviceId")
         ci."deviceId" AS "deviceId",
         ci."cartaId"   AS "cartaId"
  FROM "carta_items" ci
  JOIN "cartas_responsivas" cr ON cr.id = ci."cartaId"
  WHERE ci."deviceId" IS NOT NULL
    AND cr."returnDate" IS NULL
  ORDER BY ci."deviceId", cr."fecha" DESC
) sub
WHERE sub."deviceId" = d.id
  AND d.estado = 'ASIGNADO';

-- 3. Índice único (Postgres permite múltiples NULL).
CREATE UNIQUE INDEX "devices_carta_activa_uniq" ON "devices" ("cartaActivaId");