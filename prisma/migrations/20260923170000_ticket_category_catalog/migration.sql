-- Catálogo de categorías de ticket (reemplaza el enum TicketCategory).

-- 1) Tabla del catálogo.
CREATE TABLE "ticket_categories" (
    "id" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ticket_categories_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ticket_categories_nombre_key" ON "ticket_categories"("nombre");

-- 2) Categorías del enum viejo, para no perder la clasificación existente.
INSERT INTO "ticket_categories" ("id", "nombre", "activo", "createdAt", "updatedAt") VALUES
    (gen_random_uuid()::text, 'Mantenimiento', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    (gen_random_uuid()::text, 'Equipo',        true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    (gen_random_uuid()::text, 'Sistema',       true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    (gen_random_uuid()::text, 'Otro',          true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

-- 3) Nueva columna + backfill desde el enum viejo.
ALTER TABLE "tickets" ADD COLUMN "categoryId" TEXT;

UPDATE "tickets" t
SET "categoryId" = c."id"
FROM "ticket_categories" c
WHERE c."nombre" = CASE t."category"::text
    WHEN 'MANTENIMIENTO' THEN 'Mantenimiento'
    WHEN 'EQUIPO'        THEN 'Equipo'
    WHEN 'SISTEMA'       THEN 'Sistema'
    WHEN 'OTRO'          THEN 'Otro'
END;

-- 4) Eliminar la columna y el tipo viejos.
ALTER TABLE "tickets" DROP COLUMN "category";
DROP TYPE "TicketCategory";

-- 5) FK + índice.
CREATE INDEX "tickets_categoryId_idx" ON "tickets"("categoryId");
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "ticket_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;
