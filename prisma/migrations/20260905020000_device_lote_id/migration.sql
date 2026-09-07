-- Agrupa dispositivos dados de alta juntos (alta por cantidad) bajo un mismo
-- "lote" para poder editar los datos compartidos de todas las unidades a la vez.
ALTER TABLE "devices" ADD COLUMN "loteId" TEXT;

-- CreateIndex
CREATE INDEX "devices_loteId_idx" ON "devices"("loteId");
