-- Blancos F1: documento de origen del movimiento (traspasos de blancos).
ALTER TABLE "hotel_movements" ADD COLUMN "sourceDocType" TEXT,
ADD COLUMN "sourceDocId" TEXT;

CREATE INDEX "hotel_movements_sourceDocType_status_idx" ON "hotel_movements"("sourceDocType", "status");
