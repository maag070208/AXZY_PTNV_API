-- CreateEnum
CREATE TYPE "EstadoInventario" AS ENUM ('DISPONIBLE', 'PRESTADO', 'DANADO', 'MANTENIMIENTO', 'BAJA');

-- CreateEnum
CREATE TYPE "TipoMovimiento" AS ENUM ('ENTRADA', 'PRESTAMO', 'DEVOLUCION', 'BAJA', 'TRASPASO', 'AJUSTE_ENTRADA', 'AJUSTE_SALIDA', 'MANTENIMIENTO_ENTRADA', 'MANTENIMIENTO_SALIDA', 'REVERSION');

-- CreateEnum
CREATE TYPE "EstadoMovimiento" AS ENUM ('ACTIVO', 'CANCELADO');

-- CreateEnum
CREATE TYPE "EstadoPrestamo" AS ENUM ('ACTIVO', 'PARCIAL', 'DEVUELTO', 'CANCELADO');

-- DropForeignKey
ALTER TABLE "carta_items" DROP CONSTRAINT IF EXISTS "carta_items_cartaId_fkey";

-- DropForeignKey
ALTER TABLE "carta_items" DROP CONSTRAINT IF EXISTS "carta_items_deviceId_fkey";

-- DropForeignKey
ALTER TABLE "cartas_responsivas" DROP CONSTRAINT IF EXISTS "cartas_responsivas_creadoPorId_fkey";

-- DropForeignKey
ALTER TABLE "cartas_responsivas" DROP CONSTRAINT IF EXISTS "cartas_responsivas_departmentId_fkey";

-- DropForeignKey
ALTER TABLE "cartas_responsivas" DROP CONSTRAINT IF EXISTS "cartas_responsivas_encargadoId_fkey";

-- DropForeignKey
ALTER TABLE "cartas_responsivas" DROP CONSTRAINT IF EXISTS "cartas_responsivas_responsableId_fkey";

-- DropForeignKey
ALTER TABLE "cartas_responsivas" DROP CONSTRAINT IF EXISTS "cartas_responsivas_subareaId_fkey";

-- DropForeignKey
ALTER TABLE "device_history" DROP CONSTRAINT IF EXISTS "device_history_autorId_fkey";

-- DropForeignKey
ALTER TABLE "device_history" DROP CONSTRAINT IF EXISTS "device_history_deviceId_fkey";

-- DropForeignKey
ALTER TABLE "devices" DROP CONSTRAINT IF EXISTS "devices_departmentId_fkey";

-- DropForeignKey
ALTER TABLE "devices" DROP CONSTRAINT IF EXISTS "devices_typeId_fkey";

-- DropForeignKey
ALTER TABLE "inventory_movements" DROP CONSTRAINT IF EXISTS "inventory_movements_departmentId_fkey";

-- DropForeignKey
ALTER TABLE "inventory_movements" DROP CONSTRAINT IF EXISTS "inventory_movements_deviceId_fkey";

-- DropForeignKey
ALTER TABLE "inventory_movements" DROP CONSTRAINT IF EXISTS "inventory_movements_prestamoId_fkey";

-- DropForeignKey
ALTER TABLE "inventory_movements" DROP CONSTRAINT IF EXISTS "inventory_movements_productTypeId_fkey";

-- DropForeignKey
ALTER TABLE "inventory_movements" DROP CONSTRAINT IF EXISTS "inventory_movements_userId_fkey";

-- DropForeignKey
ALTER TABLE "material_outputs" DROP CONSTRAINT IF EXISTS "material_outputs_deviceId_fkey";

-- DropIndex
DROP INDEX IF EXISTS "material_outputs_deviceId_idx";

-- AlterTable
ALTER TABLE "material_outputs" DROP COLUMN IF EXISTS "deviceId",
ADD COLUMN     "unidadFisicaId" TEXT;

-- DropTable
DROP TABLE IF EXISTS "carta_items";

-- DropTable
DROP TABLE IF EXISTS "cartas_responsivas";

-- DropTable
DROP TABLE IF EXISTS "device_history";

-- DropTable
DROP TABLE IF EXISTS "device_types";

-- DropTable
DROP TABLE IF EXISTS "devices";

-- DropTable
DROP TABLE IF EXISTS "inventory_movements";

-- DropEnum
DROP TYPE IF EXISTS "DeviceEstado";

-- DropEnum
DROP TYPE IF EXISTS "MovementType";

-- DropEnum
DROP TYPE IF EXISTS "StockMotivo";

-- CreateTable
CREATE TABLE "tipos_dispositivo" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "folioPrefix" TEXT NOT NULL,
    "contador" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tipos_dispositivo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dispositivos" (
    "id" TEXT NOT NULL,
    "tipoId" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "marca" TEXT NOT NULL,
    "modelo" TEXT NOT NULL,
    "descripcion" TEXT,
    "observaciones" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "dispositivos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "unidades_fisicas" (
    "id" TEXT NOT NULL,
    "dispositivoId" TEXT NOT NULL,
    "activoFijo" TEXT NOT NULL,
    "numeroSerie" TEXT,
    "macAddress" TEXT,
    "ip" TEXT,
    "nombreEquipo" TEXT,
    "area" TEXT NOT NULL DEFAULT 'SISTEMAS',
    "estado" "EstadoInventario" NOT NULL DEFAULT 'DISPONIBLE',
    "departamentoId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "unidades_fisicas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "movimientos" (
    "id" TEXT NOT NULL,
    "tipo" "TipoMovimiento" NOT NULL,
    "fecha" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "usuarioId" TEXT NOT NULL,
    "responsableId" TEXT,
    "departamentoId" TEXT,
    "motivo" TEXT,
    "observaciones" TEXT,
    "status" "EstadoMovimiento" NOT NULL DEFAULT 'ACTIVO',
    "reversaDeId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "movimientos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "movimiento_detalles" (
    "id" TEXT NOT NULL,
    "movimientoId" TEXT NOT NULL,
    "dispositivoId" TEXT NOT NULL,
    "cantidad" INTEGER NOT NULL,
    "condicion" "CondicionEnum",
    "observaciones" TEXT,

    CONSTRAINT "movimiento_detalles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prestamos" (
    "id" TEXT NOT NULL,
    "responsableId" TEXT NOT NULL,
    "departamentoId" TEXT,
    "fecha" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "EstadoPrestamo" NOT NULL DEFAULT 'ACTIVO',
    "movimientoId" TEXT,
    "consecutivo" TEXT NOT NULL,
    "observaciones" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "prestamos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prestamo_detalles" (
    "id" TEXT NOT NULL,
    "prestamoId" TEXT NOT NULL,
    "dispositivoId" TEXT NOT NULL,
    "cantidad" INTEGER NOT NULL,
    "devuelto" INTEGER NOT NULL DEFAULT 0,
    "observaciones" TEXT,

    CONSTRAINT "prestamo_detalles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prestamo_detalle_unidades" (
    "id" TEXT NOT NULL,
    "prestamoDetalleId" TEXT NOT NULL,
    "unidadFisicaId" TEXT NOT NULL,
    "devuelto" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "prestamo_detalle_unidades_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "devoluciones" (
    "id" TEXT NOT NULL,
    "prestamoId" TEXT NOT NULL,
    "movimientoId" TEXT NOT NULL,
    "fecha" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "responsableId" TEXT,
    "consecutivo" TEXT NOT NULL,
    "observaciones" TEXT,

    CONSTRAINT "devoluciones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "devolucion_detalles" (
    "id" TEXT NOT NULL,
    "devolucionId" TEXT NOT NULL,
    "prestamoDetalleId" TEXT NOT NULL,
    "dispositivoId" TEXT NOT NULL,
    "cantidad" INTEGER NOT NULL,
    "condicion" "CondicionEnum" NOT NULL,

    CONSTRAINT "devolucion_detalles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "devolucion_detalle_unidades" (
    "id" TEXT NOT NULL,
    "devolucionDetalleId" TEXT NOT NULL,
    "unidadFisicaId" TEXT NOT NULL,

    CONSTRAINT "devolucion_detalle_unidades_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tipos_dispositivo_code_key" ON "tipos_dispositivo"("code");

-- CreateIndex
CREATE UNIQUE INDEX "tipos_dispositivo_folioPrefix_key" ON "tipos_dispositivo"("folioPrefix");

-- CreateIndex
CREATE INDEX "dispositivos_tipoId_idx" ON "dispositivos"("tipoId");

-- CreateIndex
CREATE UNIQUE INDEX "dispositivos_tipoId_nombre_marca_modelo_key" ON "dispositivos"("tipoId", "nombre", "marca", "modelo");

-- CreateIndex
CREATE UNIQUE INDEX "unidades_fisicas_activoFijo_key" ON "unidades_fisicas"("activoFijo");

-- CreateIndex
CREATE UNIQUE INDEX "unidades_fisicas_macAddress_key" ON "unidades_fisicas"("macAddress");

-- CreateIndex
CREATE INDEX "unidades_fisicas_dispositivoId_idx" ON "unidades_fisicas"("dispositivoId");

-- CreateIndex
CREATE INDEX "unidades_fisicas_estado_idx" ON "unidades_fisicas"("estado");

-- CreateIndex
CREATE INDEX "unidades_fisicas_departamentoId_idx" ON "unidades_fisicas"("departamentoId");

-- CreateIndex
CREATE UNIQUE INDEX "movimientos_reversaDeId_key" ON "movimientos"("reversaDeId");

-- CreateIndex
CREATE INDEX "movimientos_fecha_idx" ON "movimientos"("fecha");

-- CreateIndex
CREATE INDEX "movimientos_tipo_idx" ON "movimientos"("tipo");

-- CreateIndex
CREATE INDEX "movimientos_status_idx" ON "movimientos"("status");

-- CreateIndex
CREATE INDEX "movimiento_detalles_movimientoId_idx" ON "movimiento_detalles"("movimientoId");

-- CreateIndex
CREATE INDEX "movimiento_detalles_dispositivoId_idx" ON "movimiento_detalles"("dispositivoId");

-- CreateIndex
CREATE UNIQUE INDEX "prestamos_movimientoId_key" ON "prestamos"("movimientoId");

-- CreateIndex
CREATE UNIQUE INDEX "prestamos_consecutivo_key" ON "prestamos"("consecutivo");

-- CreateIndex
CREATE INDEX "prestamos_responsableId_idx" ON "prestamos"("responsableId");

-- CreateIndex
CREATE INDEX "prestamos_status_idx" ON "prestamos"("status");

-- CreateIndex
CREATE INDEX "prestamo_detalles_prestamoId_idx" ON "prestamo_detalles"("prestamoId");

-- CreateIndex
CREATE INDEX "prestamo_detalles_dispositivoId_idx" ON "prestamo_detalles"("dispositivoId");

-- CreateIndex
CREATE INDEX "prestamo_detalle_unidades_unidadFisicaId_idx" ON "prestamo_detalle_unidades"("unidadFisicaId");

-- CreateIndex
CREATE UNIQUE INDEX "prestamo_detalle_unidades_prestamoDetalleId_unidadFisicaId_key" ON "prestamo_detalle_unidades"("prestamoDetalleId", "unidadFisicaId");

-- CreateIndex
CREATE UNIQUE INDEX "devoluciones_movimientoId_key" ON "devoluciones"("movimientoId");

-- CreateIndex
CREATE UNIQUE INDEX "devoluciones_consecutivo_key" ON "devoluciones"("consecutivo");

-- CreateIndex
CREATE INDEX "devoluciones_prestamoId_idx" ON "devoluciones"("prestamoId");

-- CreateIndex
CREATE INDEX "devolucion_detalles_devolucionId_idx" ON "devolucion_detalles"("devolucionId");

-- CreateIndex
CREATE INDEX "devolucion_detalles_prestamoDetalleId_idx" ON "devolucion_detalles"("prestamoDetalleId");

-- CreateIndex
CREATE INDEX "devolucion_detalle_unidades_unidadFisicaId_idx" ON "devolucion_detalle_unidades"("unidadFisicaId");

-- CreateIndex
CREATE UNIQUE INDEX "devolucion_detalle_unidades_devolucionDetalleId_unidadFisic_key" ON "devolucion_detalle_unidades"("devolucionDetalleId", "unidadFisicaId");

-- CreateIndex
CREATE INDEX "material_outputs_unidadFisicaId_idx" ON "material_outputs"("unidadFisicaId");

-- AddForeignKey
ALTER TABLE "dispositivos" ADD CONSTRAINT "dispositivos_tipoId_fkey" FOREIGN KEY ("tipoId") REFERENCES "tipos_dispositivo"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "unidades_fisicas" ADD CONSTRAINT "unidades_fisicas_dispositivoId_fkey" FOREIGN KEY ("dispositivoId") REFERENCES "dispositivos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "unidades_fisicas" ADD CONSTRAINT "unidades_fisicas_departamentoId_fkey" FOREIGN KEY ("departamentoId") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimientos" ADD CONSTRAINT "movimientos_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimientos" ADD CONSTRAINT "movimientos_responsableId_fkey" FOREIGN KEY ("responsableId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimientos" ADD CONSTRAINT "movimientos_departamentoId_fkey" FOREIGN KEY ("departamentoId") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimientos" ADD CONSTRAINT "movimientos_reversaDeId_fkey" FOREIGN KEY ("reversaDeId") REFERENCES "movimientos"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimiento_detalles" ADD CONSTRAINT "movimiento_detalles_movimientoId_fkey" FOREIGN KEY ("movimientoId") REFERENCES "movimientos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimiento_detalles" ADD CONSTRAINT "movimiento_detalles_dispositivoId_fkey" FOREIGN KEY ("dispositivoId") REFERENCES "dispositivos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prestamos" ADD CONSTRAINT "prestamos_responsableId_fkey" FOREIGN KEY ("responsableId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prestamos" ADD CONSTRAINT "prestamos_departamentoId_fkey" FOREIGN KEY ("departamentoId") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prestamos" ADD CONSTRAINT "prestamos_movimientoId_fkey" FOREIGN KEY ("movimientoId") REFERENCES "movimientos"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prestamo_detalles" ADD CONSTRAINT "prestamo_detalles_prestamoId_fkey" FOREIGN KEY ("prestamoId") REFERENCES "prestamos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prestamo_detalles" ADD CONSTRAINT "prestamo_detalles_dispositivoId_fkey" FOREIGN KEY ("dispositivoId") REFERENCES "dispositivos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prestamo_detalle_unidades" ADD CONSTRAINT "prestamo_detalle_unidades_prestamoDetalleId_fkey" FOREIGN KEY ("prestamoDetalleId") REFERENCES "prestamo_detalles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prestamo_detalle_unidades" ADD CONSTRAINT "prestamo_detalle_unidades_unidadFisicaId_fkey" FOREIGN KEY ("unidadFisicaId") REFERENCES "unidades_fisicas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "devoluciones" ADD CONSTRAINT "devoluciones_prestamoId_fkey" FOREIGN KEY ("prestamoId") REFERENCES "prestamos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "devoluciones" ADD CONSTRAINT "devoluciones_movimientoId_fkey" FOREIGN KEY ("movimientoId") REFERENCES "movimientos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "devoluciones" ADD CONSTRAINT "devoluciones_responsableId_fkey" FOREIGN KEY ("responsableId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "devolucion_detalles" ADD CONSTRAINT "devolucion_detalles_devolucionId_fkey" FOREIGN KEY ("devolucionId") REFERENCES "devoluciones"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "devolucion_detalles" ADD CONSTRAINT "devolucion_detalles_prestamoDetalleId_fkey" FOREIGN KEY ("prestamoDetalleId") REFERENCES "prestamo_detalles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "devolucion_detalles" ADD CONSTRAINT "devolucion_detalles_dispositivoId_fkey" FOREIGN KEY ("dispositivoId") REFERENCES "dispositivos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "devolucion_detalle_unidades" ADD CONSTRAINT "devolucion_detalle_unidades_devolucionDetalleId_fkey" FOREIGN KEY ("devolucionDetalleId") REFERENCES "devolucion_detalles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "devolucion_detalle_unidades" ADD CONSTRAINT "devolucion_detalle_unidades_unidadFisicaId_fkey" FOREIGN KEY ("unidadFisicaId") REFERENCES "unidades_fisicas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "material_outputs" ADD CONSTRAINT "material_outputs_unidadFisicaId_fkey" FOREIGN KEY ("unidadFisicaId") REFERENCES "unidades_fisicas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

