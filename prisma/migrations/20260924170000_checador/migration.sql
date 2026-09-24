-- Checador (reloj Hikvision): copia de solo lectura de sus checadas y cursor de
-- sincronización por equipo.

-- CreateEnum
CREATE TYPE "MetodoChecada" AS ENUM ('ROSTRO', 'HUELLA', 'TARJETA', 'OTRO');

-- CreateTable
CREATE TABLE "checadas" (
    "id" TEXT NOT NULL,
    "dispositivoSerie" TEXT NOT NULL,
    "serialNo" INTEGER NOT NULL,
    "numeroEmpleado" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "metodo" "MetodoChecada" NOT NULL,
    "minor" INTEGER NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "checadas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "checador_sync" (
    "dispositivoSerie" TEXT NOT NULL,
    "modelo" TEXT,
    "ultimoSerialNo" INTEGER NOT NULL DEFAULT 0,
    "sincronizadoEn" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "checador_sync_pkey" PRIMARY KEY ("dispositivoSerie")
);

-- CreateIndex
CREATE INDEX "checadas_occurredAt_idx" ON "checadas"("occurredAt");

-- CreateIndex
CREATE INDEX "checadas_numeroEmpleado_occurredAt_idx" ON "checadas"("numeroEmpleado", "occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "checadas_dispositivoSerie_serialNo_key" ON "checadas"("dispositivoSerie", "serialNo");

