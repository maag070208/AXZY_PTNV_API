-- Código de barras / interno del modelo de dispositivo (identifica el producto en la carga masiva).
ALTER TABLE "devices" ADD COLUMN "code" TEXT;

-- Relleno de lo que ya existe: 10 dígitos por orden de alta (sin colisiones entre sí).
UPDATE "devices" AS d
SET "code" = lpad(s.n::text, 10, '0')
FROM (
  SELECT "id", row_number() OVER (ORDER BY "createdAt", "id") AS n
  FROM "devices"
) AS s
WHERE d."id" = s."id";

CREATE UNIQUE INDEX "devices_code_key" ON "devices"("code");
