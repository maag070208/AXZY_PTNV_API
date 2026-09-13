-- AlterTable
ALTER TABLE "cartas_responsivas" ADD COLUMN     "ubicacionId" TEXT;

-- CreateIndex
CREATE INDEX "cartas_responsivas_ubicacionId_idx" ON "cartas_responsivas"("ubicacionId");

-- AddForeignKey
ALTER TABLE "cartas_responsivas" ADD CONSTRAINT "cartas_responsivas_ubicacionId_fkey" FOREIGN KEY ("ubicacionId") REFERENCES "locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
