-- AddMovementType values
ALTER TYPE "MovementType" ADD VALUE 'PRESTAMO';
ALTER TYPE "MovementType" ADD VALUE 'DEVOLUCION';

-- CreateEnum
CREATE TYPE "CondicionEnum" AS ENUM ('BUENO', 'ACEPTABLE', 'MALO', 'ROTO');

-- RenameColumn cartas_responsivas
ALTER TABLE "cartas_responsivas" RENAME COLUMN "consecutivo" TO "consecutive";
DROP INDEX "cartas_responsivas_consecutivo_key";
CREATE UNIQUE INDEX "cartas_responsivas_consecutive_key" ON "cartas_responsivas"("consecutive");
DROP INDEX "cartas_responsivas_consecutivo_idx";
CREATE INDEX "cartas_responsivas_consecutive_idx" ON "cartas_responsivas"("consecutive");

-- AlterTable
ALTER TABLE "inventory_movements" ADD COLUMN     "prestamoId" TEXT;
ALTER TABLE "inventory_movements" ADD COLUMN     "prestadoA" TEXT;
ALTER TABLE "inventory_movements" ADD COLUMN     "fechaRetornoEsperado" TIMESTAMP(3);
ALTER TABLE "inventory_movements" ADD COLUMN     "condicion" "CondicionEnum";
ALTER TABLE "inventory_movements" ADD COLUMN     "motivoBaja" TEXT;

-- CreateIndex
CREATE INDEX "inventory_movements_prestamoId_idx" ON "inventory_movements"("prestamoId");

-- AddForeignKey
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_prestamoId_fkey" FOREIGN KEY ("prestamoId") REFERENCES "inventory_movements"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AlterTable cartas_responsivas
ALTER TABLE "cartas_responsivas" ADD COLUMN     "inventoryMovementId" TEXT;
CREATE INDEX "cartas_responsivas_inventoryMovementId_idx" ON "cartas_responsivas"("inventoryMovementId");
ALTER TABLE "cartas_responsivas" ADD CONSTRAINT "cartas_responsivas_inventoryMovementId_fkey" FOREIGN KEY ("inventoryMovementId") REFERENCES "inventory_movements"("id") ON DELETE SET NULL ON UPDATE CASCADE;