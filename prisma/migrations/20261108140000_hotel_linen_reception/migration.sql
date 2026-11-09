-- Blancos F4: recepción (préstamo de toallas, corte de turno, adicionales a habitación y equipos).

-- AlterEnum
ALTER TYPE "HotelMovementType" ADD VALUE IF NOT EXISTS 'EXTRA_RETURN';

-- CreateEnum
CREATE TYPE "HotelDepositMethod" AS ENUM ('CASH', 'CARD', 'ROOM_CHARGE');
CREATE TYPE "HotelTowelLoanStatus" AS ENUM ('OPEN', 'PARTIAL', 'RETURNED', 'UNRETURNED');
CREATE TYPE "HotelExtraStatus" AS ENUM ('REQUESTED', 'DELIVERED', 'COLLECTED', 'MISSING', 'CANCELLED');
CREATE TYPE "HotelExtraKind" AS ENUM ('LINEN', 'CONSUMABLE');
CREATE TYPE "HotelEquipmentStatus" AS ENUM ('AVAILABLE', 'LOANED', 'IN_REPAIR', 'MISSING', 'RETIRED');
CREATE TYPE "HotelEquipmentCondition" AS ENUM ('GOOD', 'DAMAGED', 'MISSING');

-- CreateTable
CREATE TABLE "hotel_shift_closes" (
    "id" TEXT NOT NULL,
    "folio" TEXT NOT NULL,
    "pointWarehouseId" TEXT NOT NULL,
    "closedById" TEXT NOT NULL,
    "receivedById" TEXT,
    "endOfDay" BOOLEAN NOT NULL DEFAULT false,
    "from" TIMESTAMP(3) NOT NULL,
    "to" TIMESTAMP(3) NOT NULL,
    "lent" DECIMAL(12,3) NOT NULL DEFAULT 0,
    "returned" DECIMAL(12,3) NOT NULL DEFAULT 0,
    "unreturned" DECIMAL(12,3) NOT NULL DEFAULT 0,
    "depositsCollected" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "depositsReturned" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "depositsRetained" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hotel_shift_closes_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "hotel_towel_loans" (
    "id" TEXT NOT NULL,
    "folio" TEXT NOT NULL,
    "pointWarehouseId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "quantity" DECIMAL(12,3) NOT NULL,
    "guestName" TEXT NOT NULL,
    "room" TEXT,
    "visitorId" TEXT,
    "depositUnit" DECIMAL(12,2) NOT NULL,
    "depositMethod" "HotelDepositMethod" NOT NULL,
    "status" "HotelTowelLoanStatus" NOT NULL DEFAULT 'OPEN',
    "lentById" TEXT NOT NULL,
    "lentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "returnedQty" DECIMAL(12,3) NOT NULL DEFAULT 0,
    "returnedById" TEXT,
    "returnedAt" TIMESTAMP(3),
    "shiftCloseId" TEXT,
    "notes" TEXT,

    CONSTRAINT "hotel_towel_loans_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "hotel_room_extras" (
    "id" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "quantity" DECIMAL(12,3) NOT NULL,
    "kind" "HotelExtraKind" NOT NULL,
    "sourceWarehouseId" TEXT NOT NULL,
    "notes" TEXT,
    "status" "HotelExtraStatus" NOT NULL DEFAULT 'REQUESTED',
    "requestedById" TEXT NOT NULL,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deliveredById" TEXT,
    "deliveredAt" TIMESTAMP(3),
    "collectedById" TEXT,
    "collectedAt" TIMESTAMP(3),
    "collectedQty" DECIMAL(12,3),
    "missingQty" DECIMAL(12,3) NOT NULL DEFAULT 0,
    "movementId" TEXT,

    CONSTRAINT "hotel_room_extras_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "hotel_equipment_units" (
    "id" TEXT NOT NULL,
    "tag" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "status" "HotelEquipmentStatus" NOT NULL DEFAULT 'AVAILABLE',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hotel_equipment_units_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "hotel_equipment_loans" (
    "id" TEXT NOT NULL,
    "unitId" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "requestedById" TEXT NOT NULL,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deliveredById" TEXT,
    "deliveredAt" TIMESTAMP(3),
    "returnedAt" TIMESTAMP(3),
    "returnedById" TEXT,
    "condition" "HotelEquipmentCondition",
    "chargeAmount" DECIMAL(12,2),
    "ticketId" TEXT,
    "notes" TEXT,

    CONSTRAINT "hotel_equipment_loans_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "hotel_shift_closes_folio_key" ON "hotel_shift_closes"("folio");
CREATE INDEX "hotel_shift_closes_pointWarehouseId_to_idx" ON "hotel_shift_closes"("pointWarehouseId", "to");
CREATE UNIQUE INDEX "hotel_towel_loans_folio_key" ON "hotel_towel_loans"("folio");
CREATE INDEX "hotel_towel_loans_pointWarehouseId_status_idx" ON "hotel_towel_loans"("pointWarehouseId", "status");
CREATE INDEX "hotel_towel_loans_shiftCloseId_idx" ON "hotel_towel_loans"("shiftCloseId");
CREATE INDEX "hotel_room_extras_status_roomId_idx" ON "hotel_room_extras"("status", "roomId");
CREATE INDEX "hotel_room_extras_requestedAt_idx" ON "hotel_room_extras"("requestedAt");
CREATE UNIQUE INDEX "hotel_equipment_units_tag_key" ON "hotel_equipment_units"("tag");
CREATE INDEX "hotel_equipment_units_productId_status_idx" ON "hotel_equipment_units"("productId", "status");
CREATE INDEX "hotel_equipment_loans_unitId_returnedAt_idx" ON "hotel_equipment_loans"("unitId", "returnedAt");
CREATE INDEX "hotel_equipment_loans_roomId_returnedAt_idx" ON "hotel_equipment_loans"("roomId", "returnedAt");

-- AddForeignKey
ALTER TABLE "hotel_shift_closes" ADD CONSTRAINT "hotel_shift_closes_pointWarehouseId_fkey" FOREIGN KEY ("pointWarehouseId") REFERENCES "hotel_warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "hotel_shift_closes" ADD CONSTRAINT "hotel_shift_closes_closedById_fkey" FOREIGN KEY ("closedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "hotel_shift_closes" ADD CONSTRAINT "hotel_shift_closes_receivedById_fkey" FOREIGN KEY ("receivedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "hotel_shift_closes" ADD CONSTRAINT "hotel_shift_closes_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "hotel_towel_loans" ADD CONSTRAINT "hotel_towel_loans_pointWarehouseId_fkey" FOREIGN KEY ("pointWarehouseId") REFERENCES "hotel_warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "hotel_towel_loans" ADD CONSTRAINT "hotel_towel_loans_productId_fkey" FOREIGN KEY ("productId") REFERENCES "hotel_products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "hotel_towel_loans" ADD CONSTRAINT "hotel_towel_loans_lentById_fkey" FOREIGN KEY ("lentById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "hotel_towel_loans" ADD CONSTRAINT "hotel_towel_loans_returnedById_fkey" FOREIGN KEY ("returnedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "hotel_towel_loans" ADD CONSTRAINT "hotel_towel_loans_shiftCloseId_fkey" FOREIGN KEY ("shiftCloseId") REFERENCES "hotel_shift_closes"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "hotel_room_extras" ADD CONSTRAINT "hotel_room_extras_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "hotel_rooms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "hotel_room_extras" ADD CONSTRAINT "hotel_room_extras_productId_fkey" FOREIGN KEY ("productId") REFERENCES "hotel_products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "hotel_room_extras" ADD CONSTRAINT "hotel_room_extras_sourceWarehouseId_fkey" FOREIGN KEY ("sourceWarehouseId") REFERENCES "hotel_warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "hotel_room_extras" ADD CONSTRAINT "hotel_room_extras_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "hotel_room_extras" ADD CONSTRAINT "hotel_room_extras_deliveredById_fkey" FOREIGN KEY ("deliveredById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "hotel_room_extras" ADD CONSTRAINT "hotel_room_extras_collectedById_fkey" FOREIGN KEY ("collectedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "hotel_equipment_units" ADD CONSTRAINT "hotel_equipment_units_productId_fkey" FOREIGN KEY ("productId") REFERENCES "hotel_products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "hotel_equipment_units" ADD CONSTRAINT "hotel_equipment_units_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "hotel_warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "hotel_equipment_loans" ADD CONSTRAINT "hotel_equipment_loans_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "hotel_equipment_units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "hotel_equipment_loans" ADD CONSTRAINT "hotel_equipment_loans_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "hotel_rooms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "hotel_equipment_loans" ADD CONSTRAINT "hotel_equipment_loans_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "hotel_equipment_loans" ADD CONSTRAINT "hotel_equipment_loans_deliveredById_fkey" FOREIGN KEY ("deliveredById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "hotel_equipment_loans" ADD CONSTRAINT "hotel_equipment_loans_returnedById_fkey" FOREIGN KEY ("returnedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "hotel_equipment_loans" ADD CONSTRAINT "hotel_equipment_loans_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "tickets"("id") ON DELETE SET NULL ON UPDATE CASCADE;
