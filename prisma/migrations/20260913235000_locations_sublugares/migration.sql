-- Crear modelo Sublugar (sub-áreas por ubicación)
CREATE TABLE "sublugares" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "numero" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sublugares_pkey" PRIMARY KEY ("id")
);

-- Location: agregar soft-delete activo y lugar obligatorio
ALTER TABLE "locations"
    ADD COLUMN "active" BOOLEAN NOT NULL DEFAULT true,
    ALTER COLUMN "lugar" SET NOT NULL;

-- Backfill: mover el subLugar/numero legacy a sub-áreas (un renglón por combo)
INSERT INTO "sublugares" ("id", "locationId", "name", "numero", "active", "createdAt")
SELECT DISTINCT ON (l."id", l."subLugar", l."numero")
       gen_random_uuid(), l."id", l."subLugar", l."numero", true, now()
FROM "locations" l
WHERE (l."subLugar" IS NOT NULL AND trim(l."subLugar") <> '')
   OR (l."numero" IS NOT NULL AND trim(l."numero") <> '');

-- Índice y FK de sublugares
CREATE UNIQUE INDEX "sublugares_locationId_name_numero_key" ON "sublugares"("locationId", "name", "numero");
ALTER TABLE "sublugares" ADD CONSTRAINT "sublugares_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "locations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Dropear columnas legacy (ya respaldadas en sublugares)
ALTER TABLE "locations" DROP COLUMN IF EXISTS "subLugar";
ALTER TABLE "locations" DROP COLUMN IF EXISTS "numero";