-- Blancos v3 F3: 2ª firma en limpio a área y entrega de amenidades.
ALTER TYPE "HotelMovementType" ADD VALUE IF NOT EXISTS 'AMENITY_DELIVERY';

-- CreateEnum
CREATE TYPE "HotelSignoffStatus" AS ENUM ('PENDING', 'CONFORM', 'DIFFERENCE');

-- AlterTable
ALTER TABLE "hotel_movements"
  ADD COLUMN "signoffStatus" "HotelSignoffStatus",
  ADD COLUMN "signoffById" TEXT,
  ADD COLUMN "signoffAt" TIMESTAMP(3),
  ADD COLUMN "signoffNotes" TEXT,
  ADD COLUMN "recipientId" TEXT;

-- CreateIndex
CREATE INDEX "hotel_movements_signoffStatus_idx" ON "hotel_movements"("signoffStatus");

-- AddForeignKey
ALTER TABLE "hotel_movements" ADD CONSTRAINT "hotel_movements_signoffById_fkey" FOREIGN KEY ("signoffById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "hotel_movements" ADD CONSTRAINT "hotel_movements_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Permisos nuevos (la matriz por rol se siembra desde seed-data al arrancar).
INSERT INTO "permissions" ("key", "module", "name", "description", "scopes", "sensitive", "active", "sortOrder", "updatedAt")
VALUES
  ('hotel_linen.transfer_signoff', 'Blancos', 'Transfer sign-off', 'Give conformity (or report a difference) on clean linen delivered to an area',
   ARRAY['NONE', 'AREA', 'ALL']::"PermissionScope"[], false, true, 1040, CURRENT_TIMESTAMP),
  ('hotel_linen.amenity_delivery', 'Blancos', 'Amenity delivery', 'Deliver amenities from the warehouse to a housekeeping supervisor',
   ARRAY['NONE', 'ALL']::"PermissionScope"[], false, true, 1041, CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;
