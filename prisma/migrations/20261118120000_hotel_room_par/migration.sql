-- Composicion de habitaciones y dotacion por componente (Blancos v3, F1).

-- CreateEnum
CREATE TYPE "HotelRoomComponent" AS ENUM ('ROOM', 'KING_BED', 'QUEEN_BED', 'SOFA_BED', 'BATHROOM');

-- AlterTable
ALTER TABLE "hotel_rooms"
ADD COLUMN "kingBeds" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "queenBeds" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "sofaBeds" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "bathrooms" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "hotel_rooms" ADD CONSTRAINT "hotel_rooms_composition_check"
CHECK ("kingBeds" >= 0 AND "queenBeds" >= 0 AND "sofaBeds" >= 0 AND "bathrooms" >= 0);

-- CreateTable
CREATE TABLE "hotel_room_pars" (
    "id" TEXT NOT NULL,
    "component" "HotelRoomComponent" NOT NULL,
    "productId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hotel_room_pars_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "hotel_room_pars_quantity_check" CHECK ("quantity" > 0)
);

-- CreateIndex
CREATE UNIQUE INDEX "hotel_room_pars_component_productId_key" ON "hotel_room_pars"("component", "productId");

-- CreateIndex
CREATE INDEX "hotel_room_pars_productId_idx" ON "hotel_room_pars"("productId");

-- AddForeignKey
ALTER TABLE "hotel_room_pars" ADD CONSTRAINT "hotel_room_pars_productId_fkey" FOREIGN KEY ("productId") REFERENCES "hotel_products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
