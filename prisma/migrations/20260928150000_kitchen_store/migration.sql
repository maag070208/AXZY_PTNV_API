-- Almacén de cocina (KITCHEN_STORE.md) y rol CHEF.
-- El rol se usa (matriz de permisos) en la migración siguiente: Postgres no
-- deja usar un valor de enum recién agregado dentro de la misma transacción.

-- CreateEnum
CREATE TYPE "KitchenItemKind" AS ENUM ('CONSUMABLE', 'DURABLE');

-- CreateEnum
CREATE TYPE "KitchenUnit" AS ENUM ('KG', 'G', 'L', 'ML', 'PIECE', 'PACKAGE');

-- CreateEnum
CREATE TYPE "KitchenStorage" AS ENUM ('DRY', 'REFRIGERATED', 'FROZEN');

-- CreateEnum
CREATE TYPE "KitchenMovementType" AS ENUM ('STOCK_IN', 'CONSUMPTION', 'WASTE', 'ADJUSTMENT_IN', 'ADJUSTMENT_OUT', 'REVERSAL');

-- CreateEnum
CREATE TYPE "KitchenWasteReason" AS ENUM ('EXPIRED', 'SPOILED', 'BREAKAGE', 'LOSS', 'OTHER');

-- AlterEnum
ALTER TYPE "Role" ADD VALUE 'CHEF';

-- CreateTable
CREATE TABLE "kitchen_categories" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "kitchen_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "suppliers" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "rfc" TEXT,
    "contact" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "suppliers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kitchen_items" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "kind" "KitchenItemKind" NOT NULL,
    "unit" "KitchenUnit" NOT NULL,
    "storage" "KitchenStorage" NOT NULL DEFAULT 'DRY',
    "tracksExpiry" BOOLEAN NOT NULL DEFAULT true,
    "minStock" DECIMAL(12,3) NOT NULL DEFAULT 0,
    "maxStock" DECIMAL(12,3),
    "notes" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "kitchen_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kitchen_lots" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "lotCode" TEXT NOT NULL,
    "expiresAt" DATE,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "supplierId" TEXT,
    "unitCost" DECIMAL(12,4),
    "quantityIn" DECIMAL(12,3) NOT NULL,
    "onHand" DECIMAL(12,3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "kitchen_lots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kitchen_movements" (
    "id" TEXT NOT NULL,
    "type" "KitchenMovementType" NOT NULL,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT NOT NULL,
    "reference" TEXT,
    "notes" TEXT,
    "wasteReason" "KitchenWasteReason",
    "status" "MovementStatus" NOT NULL DEFAULT 'ACTIVE',
    "reversalOfId" TEXT,
    "requestId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "kitchen_movements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kitchen_movement_lines" (
    "id" TEXT NOT NULL,
    "movementId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "lotId" TEXT NOT NULL,
    "quantity" DECIMAL(12,3) NOT NULL,
    "unitCost" DECIMAL(12,4),

    CONSTRAINT "kitchen_movement_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "kitchen_categories_name_key" ON "kitchen_categories"("name");

-- CreateIndex
CREATE UNIQUE INDEX "suppliers_name_key" ON "suppliers"("name");

-- CreateIndex
CREATE UNIQUE INDEX "kitchen_items_code_key" ON "kitchen_items"("code");

-- CreateIndex
CREATE INDEX "kitchen_items_categoryId_idx" ON "kitchen_items"("categoryId");

-- CreateIndex
CREATE INDEX "kitchen_items_name_idx" ON "kitchen_items"("name");

-- CreateIndex
CREATE INDEX "kitchen_lots_itemId_expiresAt_idx" ON "kitchen_lots"("itemId", "expiresAt");

-- CreateIndex
CREATE INDEX "kitchen_lots_expiresAt_idx" ON "kitchen_lots"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "kitchen_lots_itemId_lotCode_key" ON "kitchen_lots"("itemId", "lotCode");

-- CreateIndex
CREATE UNIQUE INDEX "kitchen_movements_reversalOfId_key" ON "kitchen_movements"("reversalOfId");

-- CreateIndex
CREATE UNIQUE INDEX "kitchen_movements_requestId_key" ON "kitchen_movements"("requestId");

-- CreateIndex
CREATE INDEX "kitchen_movements_date_idx" ON "kitchen_movements"("date");

-- CreateIndex
CREATE INDEX "kitchen_movements_type_idx" ON "kitchen_movements"("type");

-- CreateIndex
CREATE INDEX "kitchen_movements_status_idx" ON "kitchen_movements"("status");

-- CreateIndex
CREATE INDEX "kitchen_movement_lines_movementId_idx" ON "kitchen_movement_lines"("movementId");

-- CreateIndex
CREATE INDEX "kitchen_movement_lines_itemId_idx" ON "kitchen_movement_lines"("itemId");

-- CreateIndex
CREATE INDEX "kitchen_movement_lines_lotId_idx" ON "kitchen_movement_lines"("lotId");

-- AddForeignKey
ALTER TABLE "kitchen_items" ADD CONSTRAINT "kitchen_items_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "kitchen_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kitchen_lots" ADD CONSTRAINT "kitchen_lots_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "kitchen_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kitchen_lots" ADD CONSTRAINT "kitchen_lots_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kitchen_movements" ADD CONSTRAINT "kitchen_movements_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kitchen_movements" ADD CONSTRAINT "kitchen_movements_reversalOfId_fkey" FOREIGN KEY ("reversalOfId") REFERENCES "kitchen_movements"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kitchen_movement_lines" ADD CONSTRAINT "kitchen_movement_lines_movementId_fkey" FOREIGN KEY ("movementId") REFERENCES "kitchen_movements"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kitchen_movement_lines" ADD CONSTRAINT "kitchen_movement_lines_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "kitchen_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kitchen_movement_lines" ADD CONSTRAINT "kitchen_movement_lines_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "kitchen_lots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Integridad que Prisma no modela (misma idea que 20260927140000_inventory_integrity).
ALTER TABLE "kitchen_items"
  ADD CONSTRAINT "kitchen_items_stock_limits_check"
  CHECK ("minStock" >= 0 AND ("maxStock" IS NULL OR "maxStock" >= "minStock"));

ALTER TABLE "kitchen_lots"
  ADD CONSTRAINT "kitchen_lots_quantity_in_check" CHECK ("quantityIn" > 0),
  ADD CONSTRAINT "kitchen_lots_on_hand_check" CHECK ("onHand" >= 0);

ALTER TABLE "kitchen_movement_lines"
  ADD CONSTRAINT "kitchen_movement_lines_quantity_check" CHECK ("quantity" > 0);
