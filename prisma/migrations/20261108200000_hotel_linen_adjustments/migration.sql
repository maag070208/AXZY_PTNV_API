-- Ajustes del demo v2 de Blancos: vida util por articulo, estandar de amenidades por
-- habitacion ocupada y almacen de origen de las bajas retenidas en cuarentena.

-- AlterTable
ALTER TABLE "hotel_products"
ADD COLUMN "washLife" INTEGER,
ADD COLUMN "standardPerRoom" DECIMAL(12,3) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "hotel_movements" ADD COLUMN "originWarehouseId" TEXT;

-- AddForeignKey
ALTER TABLE "hotel_movements" ADD CONSTRAINT "hotel_movements_originWarehouseId_fkey" FOREIGN KEY ("originWarehouseId") REFERENCES "hotel_warehouses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "hotel_movements_originWarehouseId_idx" ON "hotel_movements"("originWarehouseId");

-- Backfill: en las bajas existentes el origen era el almacen del que salian.
UPDATE "hotel_movements"
SET "originWarehouseId" = "fromWarehouseId"
WHERE "type" = 'WRITE_OFF' AND "originWarehouseId" IS NULL;

-- La lavanderia necesita su ubicacion de cuarentena (retencion de bajas fisicas).
INSERT INTO "hotel_locations" ("id", "warehouseId", "code", "isDefault", "active")
SELECT gen_random_uuid()::text, w."id", 'QUARANTINE', false, true
FROM "hotel_warehouses" w WHERE w."kind" = 'LAUNDRY'
ON CONFLICT ("warehouseId", "code") DO NOTHING;

-- Motivo del ajuste de stock al cerrar el control semanal de amenidades.
INSERT INTO "hotel_reasons" ("id", "kind", "name", "requiresNotes", "active")
VALUES (gen_random_uuid()::text, 'ADJUSTMENT', 'Consumo de amenidades', false, true)
ON CONFLICT ("kind", "name") DO NOTHING;
