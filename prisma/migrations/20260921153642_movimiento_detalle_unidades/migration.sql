-- CreateTable
CREATE TABLE "movimiento_detalle_unidades" (
    "id" TEXT NOT NULL,
    "movimientoDetalleId" TEXT NOT NULL,
    "unidadFisicaId" TEXT NOT NULL,

    CONSTRAINT "movimiento_detalle_unidades_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "movimiento_detalle_unidades_unidadFisicaId_idx" ON "movimiento_detalle_unidades"("unidadFisicaId");

-- CreateIndex
CREATE UNIQUE INDEX "movimiento_detalle_unidades_movimientoDetalleId_unidadFisic_key" ON "movimiento_detalle_unidades"("movimientoDetalleId", "unidadFisicaId");

-- AddForeignKey
ALTER TABLE "movimiento_detalle_unidades" ADD CONSTRAINT "movimiento_detalle_unidades_movimientoDetalleId_fkey" FOREIGN KEY ("movimientoDetalleId") REFERENCES "movimiento_detalles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimiento_detalle_unidades" ADD CONSTRAINT "movimiento_detalle_unidades_unidadFisicaId_fkey" FOREIGN KEY ("unidadFisicaId") REFERENCES "unidades_fisicas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
