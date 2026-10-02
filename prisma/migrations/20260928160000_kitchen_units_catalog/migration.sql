-- Las unidades de medida de cocina pasan de enum a catálogo administrable
-- (el chef puede agregar las que use: caja, docena, manojo…). Se conservan las
-- seis originales y cada artículo se re-apunta a su unidad por código.

CREATE TABLE "kitchen_units" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "whole" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "kitchen_units_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "kitchen_units_code_key" ON "kitchen_units"("code");

INSERT INTO "kitchen_units" ("id", "code", "name", "whole", "updatedAt") VALUES
    (gen_random_uuid()::text, 'KG', 'Kilogramo', false, CURRENT_TIMESTAMP),
    (gen_random_uuid()::text, 'G', 'Gramo', false, CURRENT_TIMESTAMP),
    (gen_random_uuid()::text, 'L', 'Litro', false, CURRENT_TIMESTAMP),
    (gen_random_uuid()::text, 'ML', 'Mililitro', false, CURRENT_TIMESTAMP),
    (gen_random_uuid()::text, 'PIECE', 'Pieza', true, CURRENT_TIMESTAMP),
    (gen_random_uuid()::text, 'PACKAGE', 'Paquete', true, CURRENT_TIMESTAMP);

ALTER TABLE "kitchen_items" ADD COLUMN "unitId" TEXT;

UPDATE "kitchen_items" i
SET "unitId" = u."id"
FROM "kitchen_units" u
WHERE u."code" = i."unit"::text;

ALTER TABLE "kitchen_items" ALTER COLUMN "unitId" SET NOT NULL;

ALTER TABLE "kitchen_items"
ADD CONSTRAINT "kitchen_items_unitId_fkey"
FOREIGN KEY ("unitId") REFERENCES "kitchen_units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "kitchen_items_unitId_idx" ON "kitchen_items"("unitId");

ALTER TABLE "kitchen_items" DROP COLUMN "unit";

DROP TYPE "KitchenUnit";
