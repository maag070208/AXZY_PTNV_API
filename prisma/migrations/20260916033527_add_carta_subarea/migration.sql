-- AlterTable
ALTER TABLE "cartas_responsivas" ADD COLUMN     "subareaId" TEXT;

-- CreateIndex
CREATE INDEX "cartas_responsivas_subareaId_idx" ON "cartas_responsivas"("subareaId");

-- AddForeignKey
ALTER TABLE "cartas_responsivas" ADD CONSTRAINT "cartas_responsivas_subareaId_fkey" FOREIGN KEY ("subareaId") REFERENCES "subareas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

