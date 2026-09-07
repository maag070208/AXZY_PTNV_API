-- CreateTable
CREATE TABLE "material_outputs" (
    "id" TEXT NOT NULL,
    "fecha" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "descripcion" TEXT NOT NULL,
    "modelo" TEXT,
    "marca" TEXT,
    "proyecto" TEXT,
    "cantidad" INTEGER NOT NULL DEFAULT 1,
    "departamento" TEXT NOT NULL,
    "usuario" TEXT NOT NULL,
    "observaciones" TEXT,
    "area" TEXT NOT NULL DEFAULT 'Sistemas',
    "deviceId" TEXT,
    "registradoPorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "material_outputs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "material_outputs_fecha_idx" ON "material_outputs"("fecha");

-- CreateIndex
CREATE INDEX "material_outputs_departamento_idx" ON "material_outputs"("departamento");

-- CreateIndex
CREATE INDEX "material_outputs_deviceId_idx" ON "material_outputs"("deviceId");

-- CreateIndex
CREATE INDEX "material_outputs_area_idx" ON "material_outputs"("area");

-- AddForeignKey
ALTER TABLE "material_outputs" ADD CONSTRAINT "material_outputs_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "devices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "material_outputs" ADD CONSTRAINT "material_outputs_registradoPorId_fkey" FOREIGN KEY ("registradoPorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
