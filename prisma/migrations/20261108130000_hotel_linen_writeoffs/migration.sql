-- Blancos F3: destino de la baja, conteo A-E y fotos de evidencia.
ALTER TABLE "hotel_movements" ADD COLUMN "disposition" TEXT;

ALTER TABLE "hotel_stocktake_lines"
  ADD COLUMN "gradeA" DECIMAL(12,3),
  ADD COLUMN "gradeB" DECIMAL(12,3),
  ADD COLUMN "gradeC" DECIMAL(12,3),
  ADD COLUMN "gradeD" DECIMAL(12,3),
  ADD COLUMN "gradeE" DECIMAL(12,3);

CREATE TABLE "hotel_writeoff_evidence" (
    "id" TEXT NOT NULL,
    "movementId" TEXT NOT NULL,
    "fileKey" TEXT NOT NULL,
    "url" TEXT,
    "mime" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "uploadedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hotel_writeoff_evidence_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "hotel_writeoff_evidence_movementId_idx" ON "hotel_writeoff_evidence"("movementId");

ALTER TABLE "hotel_writeoff_evidence" ADD CONSTRAINT "hotel_writeoff_evidence_movementId_fkey" FOREIGN KEY ("movementId") REFERENCES "hotel_movements"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "hotel_writeoff_evidence" ADD CONSTRAINT "hotel_writeoff_evidence_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
