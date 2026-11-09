-- Blancos F2: ciclo de lavandería, pedidos de área y recepción de sucios.

-- AlterEnum
ALTER TYPE "HotelMovementType" ADD VALUE 'FIRST_WASH';
ALTER TYPE "HotelMovementType" ADD VALUE 'SUPPLIER_RETURN';
ALTER TYPE "HotelMovementType" ADD VALUE 'ROOM_EXTRA';
ALTER TYPE "HotelMovementType" ADD VALUE 'LOAN_OUT';
ALTER TYPE "HotelMovementType" ADD VALUE 'LOAN_RETURN';

-- CreateEnum
CREATE TYPE "HotelSupplyRequestStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'PARTIALLY_FULFILLED', 'FULFILLED', 'RECEIVED', 'CANCELLED');

-- CreateTable
CREATE TABLE "hotel_supply_requests" (
    "id" TEXT NOT NULL,
    "folio" TEXT NOT NULL,
    "requestingWarehouseId" TEXT NOT NULL,
    "sourceWarehouseId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "shift" TEXT,
    "checkouts" INTEGER NOT NULL DEFAULT 0,
    "occupied" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "requestedById" TEXT NOT NULL,
    "status" "HotelSupplyRequestStatus" NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hotel_supply_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hotel_supply_request_lines" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "requestedQty" DECIMAL(12,3) NOT NULL,
    "deliveredQty" DECIMAL(12,3) NOT NULL DEFAULT 0,
    "receivedQty" DECIMAL(12,3) NOT NULL DEFAULT 0,
    "notes" TEXT,

    CONSTRAINT "hotel_supply_request_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hotel_dirty_receipts" (
    "id" TEXT NOT NULL,
    "folio" TEXT NOT NULL,
    "originWarehouseId" TEXT NOT NULL,
    "cartNumber" TEXT,
    "shift" TEXT,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deliveredById" TEXT NOT NULL,
    "receivedById" TEXT NOT NULL,
    "notes" TEXT,
    "movementId" TEXT,
    "hasShortage" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hotel_dirty_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hotel_dirty_receipt_lines" (
    "id" TEXT NOT NULL,
    "receiptId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "deliveredToFloor" DECIMAL(12,3) NOT NULL DEFAULT 0,
    "receivedDirty" DECIMAL(12,3) NOT NULL DEFAULT 0,
    "stillInUse" DECIMAL(12,3) NOT NULL DEFAULT 0,
    "shortage" DECIMAL(12,3) NOT NULL DEFAULT 0,
    "good" DECIMAL(12,3) NOT NULL DEFAULT 0,
    "stained" DECIMAL(12,3) NOT NULL DEFAULT 0,
    "damaged" DECIMAL(12,3) NOT NULL DEFAULT 0,

    CONSTRAINT "hotel_dirty_receipt_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "hotel_supply_requests_folio_key" ON "hotel_supply_requests"("folio");
CREATE INDEX "hotel_supply_requests_requestingWarehouseId_status_idx" ON "hotel_supply_requests"("requestingWarehouseId", "status");
CREATE INDEX "hotel_supply_requests_status_date_idx" ON "hotel_supply_requests"("status", "date");
CREATE UNIQUE INDEX "hotel_supply_request_lines_requestId_productId_key" ON "hotel_supply_request_lines"("requestId", "productId");
CREATE UNIQUE INDEX "hotel_dirty_receipts_folio_key" ON "hotel_dirty_receipts"("folio");
CREATE INDEX "hotel_dirty_receipts_originWarehouseId_date_idx" ON "hotel_dirty_receipts"("originWarehouseId", "date");
CREATE INDEX "hotel_dirty_receipts_date_idx" ON "hotel_dirty_receipts"("date");
CREATE UNIQUE INDEX "hotel_dirty_receipt_lines_receiptId_productId_key" ON "hotel_dirty_receipt_lines"("receiptId", "productId");

-- AddForeignKey
ALTER TABLE "hotel_supply_requests" ADD CONSTRAINT "hotel_supply_requests_requestingWarehouseId_fkey" FOREIGN KEY ("requestingWarehouseId") REFERENCES "hotel_warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "hotel_supply_requests" ADD CONSTRAINT "hotel_supply_requests_sourceWarehouseId_fkey" FOREIGN KEY ("sourceWarehouseId") REFERENCES "hotel_warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "hotel_supply_requests" ADD CONSTRAINT "hotel_supply_requests_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "hotel_supply_request_lines" ADD CONSTRAINT "hotel_supply_request_lines_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "hotel_supply_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "hotel_supply_request_lines" ADD CONSTRAINT "hotel_supply_request_lines_productId_fkey" FOREIGN KEY ("productId") REFERENCES "hotel_products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "hotel_dirty_receipts" ADD CONSTRAINT "hotel_dirty_receipts_originWarehouseId_fkey" FOREIGN KEY ("originWarehouseId") REFERENCES "hotel_warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "hotel_dirty_receipts" ADD CONSTRAINT "hotel_dirty_receipts_deliveredById_fkey" FOREIGN KEY ("deliveredById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "hotel_dirty_receipts" ADD CONSTRAINT "hotel_dirty_receipts_receivedById_fkey" FOREIGN KEY ("receivedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "hotel_dirty_receipt_lines" ADD CONSTRAINT "hotel_dirty_receipt_lines_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "hotel_dirty_receipts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "hotel_dirty_receipt_lines" ADD CONSTRAINT "hotel_dirty_receipt_lines_productId_fkey" FOREIGN KEY ("productId") REFERENCES "hotel_products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
