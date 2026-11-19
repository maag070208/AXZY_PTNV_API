-- Blancos: pérdidas por huésped (baja motivo G ligada a habitación y huésped). SQL a mano.

-- CreateEnum
CREATE TYPE "HotelGuestChargeStatus" AS ENUM ('NOT_CHARGED', 'PENDING', 'CHARGED', 'WAIVED');

-- AlterTable: huésped y cobro en la baja
ALTER TABLE "hotel_movements"
  ADD COLUMN "guestName" TEXT,
  ADD COLUMN "chargeStatus" "HotelGuestChargeStatus" NOT NULL DEFAULT 'NOT_CHARGED',
  ADD COLUMN "chargeAmount" DECIMAL(12,2);

-- AlterTable: vínculo de regreso desde el préstamo / adicional convertido
ALTER TABLE "hotel_towel_loans" ADD COLUMN "guestLossId" TEXT;
ALTER TABLE "hotel_room_extras" ADD COLUMN "guestLossId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "hotel_towel_loans_guestLossId_key" ON "hotel_towel_loans"("guestLossId");
CREATE UNIQUE INDEX "hotel_room_extras_guestLossId_key" ON "hotel_room_extras"("guestLossId");

-- AddForeignKey
ALTER TABLE "hotel_towel_loans" ADD CONSTRAINT "hotel_towel_loans_guestLossId_fkey"
  FOREIGN KEY ("guestLossId") REFERENCES "hotel_movements"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "hotel_room_extras" ADD CONSTRAINT "hotel_room_extras_guestLossId_fkey"
  FOREIGN KEY ("guestLossId") REFERENCES "hotel_movements"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Motivo de baja G (idempotente: insert-missing por tipo + código / nombre).
INSERT INTO "hotel_reasons" ("id", "kind", "name", "code", "requiresNotes", "active")
SELECT gen_random_uuid()::text, 'WRITE_OFF'::"HotelReasonKind", 'Llevado por huésped', 'G', false, true
WHERE NOT EXISTS (
  SELECT 1 FROM "hotel_reasons" r
  WHERE r."kind" = 'WRITE_OFF' AND (r."code" = 'G' OR r."name" = 'Llevado por huésped')
);
