-- Blancos F0: tipos de almacen, firmas, limites por almacen, codigo de motivo y ubicaciones nuevas.
-- CreateEnum
CREATE TYPE "HotelSignatureRole" AS ENUM ('DELIVERS', 'RECEIVES', 'CONFIRMS', 'REVIEWS', 'AUTHORIZES');

-- CreateEnum
CREATE TYPE "HotelSignatureMethod" AS ENUM ('SESSION', 'PASSWORD');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "HotelWarehouseKind" ADD VALUE 'NEW_LINEN';
ALTER TYPE "HotelWarehouseKind" ADD VALUE 'POINT';
ALTER TYPE "HotelWarehouseKind" ADD VALUE 'SPA';
ALTER TYPE "HotelWarehouseKind" ADD VALUE 'EQUIPMENT';

-- AlterTable
ALTER TABLE "hotel_reasons" ADD COLUMN     "code" TEXT;

-- AlterTable
ALTER TABLE "hotel_products" ADD COLUMN     "size" TEXT,
ADD COLUMN     "tagPrefix" TEXT;

-- AlterTable
ALTER TABLE "hotel_warehouses" ADD COLUMN     "custodianId" TEXT;

-- CreateTable
CREATE TABLE "hotel_warehouse_product_limits" (
    "id" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "minStock" DECIMAL(12,3) NOT NULL DEFAULT 0,
    "maxStock" DECIMAL(12,3) NOT NULL DEFAULT 0,

    CONSTRAINT "hotel_warehouse_product_limits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hotel_signatures" (
    "id" TEXT NOT NULL,
    "docType" TEXT NOT NULL,
    "docId" TEXT NOT NULL,
    "role" "HotelSignatureRole" NOT NULL,
    "userId" TEXT NOT NULL,
    "method" "HotelSignatureMethod" NOT NULL DEFAULT 'SESSION',
    "notes" TEXT,
    "signedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hotel_signatures_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "hotel_warehouse_product_limits_warehouseId_productId_key" ON "hotel_warehouse_product_limits"("warehouseId", "productId");

-- CreateIndex
CREATE INDEX "hotel_signatures_docType_docId_idx" ON "hotel_signatures"("docType", "docId");

-- CreateIndex
CREATE UNIQUE INDEX "hotel_signatures_docType_docId_role_key" ON "hotel_signatures"("docType", "docId", "role");

-- CreateIndex
CREATE UNIQUE INDEX "hotel_reasons_kind_code_key" ON "hotel_reasons"("kind", "code");

-- AddForeignKey
ALTER TABLE "hotel_warehouses" ADD CONSTRAINT "hotel_warehouses_custodianId_fkey" FOREIGN KEY ("custodianId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hotel_warehouse_product_limits" ADD CONSTRAINT "hotel_warehouse_product_limits_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "hotel_warehouses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hotel_warehouse_product_limits" ADD CONSTRAINT "hotel_warehouse_product_limits_productId_fkey" FOREIGN KEY ("productId") REFERENCES "hotel_products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hotel_signatures" ADD CONSTRAINT "hotel_signatures_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Backfill de ubicaciones nuevas (D4) para los almacenes existentes. Los tipos nuevos
-- (NEW_LINEN, POINT, SPA, EQUIPMENT) aun no existen en datos y sus ubicaciones las crea el servicio.
-- Los valores nuevos del enum no se pueden usar dentro de esta misma transaccion.
INSERT INTO "hotel_locations" ("id", "warehouseId", "code", "isDefault", "active")
SELECT gen_random_uuid()::text, w."id", 'QUARANTINE', false, true
FROM "hotel_warehouses" w WHERE w."kind" = 'LAUNDRY'
ON CONFLICT ("warehouseId", "code") DO NOTHING;

INSERT INTO "hotel_locations" ("id", "warehouseId", "code", "isDefault", "active")
SELECT gen_random_uuid()::text, w."id", 'DIRTY', false, true
FROM "hotel_warehouses" w WHERE w."kind" = 'ZONE'
ON CONFLICT ("warehouseId", "code") DO NOTHING;

INSERT INTO "hotel_locations" ("id", "warehouseId", "code", "isDefault", "active")
SELECT gen_random_uuid()::text, w."id", 'HOLD', false, true
FROM "hotel_warehouses" w WHERE w."kind" = 'CENTRAL'
ON CONFLICT ("warehouseId", "code") DO NOTHING;

-- Motivos de baja de blancos (insert-missing por tipo + codigo).
INSERT INTO "hotel_reasons" ("id", "kind", "name", "code", "requiresNotes", "active")
SELECT gen_random_uuid()::text, 'WRITE_OFF'::"HotelReasonKind", v."name", v."code", false, true
FROM (VALUES
  ('Rota', 'R'),
  ('Desgaste', 'D'),
  ('Mancha', 'M'),
  ('Quemada', 'Q'),
  ('Faltante / extravío', 'F')
) AS v("name", "code")
WHERE NOT EXISTS (
  SELECT 1 FROM "hotel_reasons" r
  WHERE r."kind" = 'WRITE_OFF' AND (r."code" = v."code" OR r."name" = v."name")
);
