-- Blancos: pedido por habitación al desocuparse (tablet). SQL a mano.

-- AlterEnum (los valores nuevos no se usan dentro de esta misma migración)
ALTER TYPE "HotelSupplyRequestStatus" ADD VALUE IF NOT EXISTS 'READY_FOR_PICKUP';
ALTER TYPE "HotelSupplyRequestStatus" ADD VALUE IF NOT EXISTS 'IN_TRANSIT';

-- CreateEnum
CREATE TYPE "HotelSupplyRequestOrigin" AS ENUM ('MANUAL', 'ROOM_TURNOVER');

-- AlterTable
ALTER TABLE "hotel_supply_requests"
  ADD COLUMN "origin" "HotelSupplyRequestOrigin" NOT NULL DEFAULT 'MANUAL',
  ADD COLUMN "roomId" TEXT,
  ADD COLUMN "carrierUserId" TEXT,
  ADD COLUMN "readyAt" TIMESTAMP(3),
  ADD COLUMN "pickedUpAt" TIMESTAMP(3),
  ADD COLUMN "deliveredAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "hotel_supply_requests_roomId_status_idx" ON "hotel_supply_requests"("roomId", "status");

-- AddForeignKey
ALTER TABLE "hotel_supply_requests" ADD CONSTRAINT "hotel_supply_requests_roomId_fkey"
  FOREIGN KEY ("roomId") REFERENCES "hotel_rooms"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "hotel_supply_requests" ADD CONSTRAINT "hotel_supply_requests_carrierUserId_fkey"
  FOREIGN KEY ("carrierUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Permiso nuevo: la auxiliar de piso recoge y entrega los pedidos.
INSERT INTO "permissions" ("key", "module", "name", "description", "scopes", "sensitive", "active", "sortOrder", "updatedAt")
VALUES
  ('hotel_linen.carry', 'Blancos', 'Carry linen orders', 'Pick up and deliver linen orders to the rooms',
   ARRAY['NONE', 'AREA', 'ALL']::"PermissionScope"[], false, true, 1042, CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "role_permissions" ("id", "role", "permission", "scope", "updatedAt")
SELECT gen_random_uuid()::text, g."role", 'hotel_linen.carry', g."scope"::"PermissionScope", CURRENT_TIMESTAMP
FROM (VALUES ('FLOOR_ASSISTANT', 'AREA'), ('ADMIN', 'ALL')) AS g("role", "scope")
WHERE EXISTS (SELECT 1 FROM "roles" r WHERE r."key" = g."role")
  AND EXISTS (SELECT 1 FROM "permissions" WHERE "key" = 'hotel_linen.carry')
ON CONFLICT ("role", "permission") DO NOTHING;
