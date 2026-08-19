-- CreateEnum
CREATE TYPE "Role" AS ENUM ('ADMIN', 'USER', 'EMPLEADO');

-- CreateEnum
CREATE TYPE "DeviceEstado" AS ENUM ('DISPONIBLE', 'ASIGNADO', 'BAJA');

-- CreateTable
CREATE TABLE "departments" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "departments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subareas" (
    "id" TEXT NOT NULL,
    "departmentId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "subareas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'EMPLEADO',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "puesto" TEXT,
    "numeroEmpleado" TEXT,
    "departmentId" TEXT,
    "subareaId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "device_types" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "contador" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "device_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "devices" (
    "id" TEXT NOT NULL,
    "typeId" TEXT NOT NULL,
    "controlActivos" TEXT NOT NULL,
    "descripcion" TEXT NOT NULL,
    "cantidad" INTEGER NOT NULL DEFAULT 1,
    "marca" TEXT NOT NULL,
    "modelo" TEXT NOT NULL,
    "numeroSerie" TEXT,
    "nombreEquipo" TEXT,
    "area" TEXT NOT NULL DEFAULT 'MANTENIMIENTO',
    "estado" "DeviceEstado" NOT NULL DEFAULT 'DISPONIBLE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "devices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cartas_responsivas" (
    "id" TEXT NOT NULL,
    "consecutivo" TEXT NOT NULL,
    "fecha" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "numeroEmpleado" TEXT NOT NULL,
    "empresa" TEXT NOT NULL DEFAULT 'Puerto Nuevo Hotel y Villas',
    "departamento" TEXT NOT NULL DEFAULT 'Departamento de Mantenimiento',
    "cantidad" INTEGER NOT NULL DEFAULT 1,
    "creadoPorId" TEXT,
    "responsableId" TEXT,
    "encargadoId" TEXT,
    "areaBoss" TEXT,
    "deliveryBy" TEXT NOT NULL DEFAULT 'Departamento de Mantenimiento',
    "returnDate" TIMESTAMP(3),
    "returnedBy" TEXT,
    "returnCondition" TEXT,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cartas_responsivas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "carta_items" (
    "id" TEXT NOT NULL,
    "cartaId" TEXT NOT NULL,
    "deviceId" TEXT,
    "descripcion" TEXT NOT NULL,
    "marca" TEXT NOT NULL,
    "modelo" TEXT NOT NULL,
    "numeroSerie" TEXT NOT NULL DEFAULT 'N/A',
    "nombreEquipo" TEXT NOT NULL DEFAULT 'N/A',
    "controlActivos" TEXT NOT NULL,
    "area" TEXT NOT NULL DEFAULT 'MANTENIMIENTO',

    CONSTRAINT "carta_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consecutivos" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "prefijo" TEXT NOT NULL DEFAULT 'F-MMTO-',
    "contador" INTEGER NOT NULL DEFAULT 0,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "consecutivos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "departments_name_key" ON "departments"("name");

-- CreateIndex
CREATE UNIQUE INDEX "subareas_departmentId_name_key" ON "subareas"("departmentId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");

-- CreateIndex
CREATE UNIQUE INDEX "users_numeroEmpleado_key" ON "users"("numeroEmpleado");

-- CreateIndex
CREATE UNIQUE INDEX "device_types_code_key" ON "device_types"("code");

-- CreateIndex
CREATE UNIQUE INDEX "device_types_prefix_key" ON "device_types"("prefix");

-- CreateIndex
CREATE UNIQUE INDEX "devices_controlActivos_key" ON "devices"("controlActivos");

-- CreateIndex
CREATE INDEX "devices_typeId_idx" ON "devices"("typeId");

-- CreateIndex
CREATE INDEX "devices_estado_idx" ON "devices"("estado");

-- CreateIndex
CREATE UNIQUE INDEX "cartas_responsivas_consecutivo_key" ON "cartas_responsivas"("consecutivo");

-- CreateIndex
CREATE INDEX "cartas_responsivas_consecutivo_idx" ON "cartas_responsivas"("consecutivo");

-- CreateIndex
CREATE INDEX "cartas_responsivas_fecha_idx" ON "cartas_responsivas"("fecha");

-- CreateIndex
CREATE INDEX "cartas_responsivas_creadoPorId_idx" ON "cartas_responsivas"("creadoPorId");

-- CreateIndex
CREATE INDEX "cartas_responsivas_responsableId_idx" ON "cartas_responsivas"("responsableId");

-- CreateIndex
CREATE INDEX "cartas_responsivas_encargadoId_idx" ON "cartas_responsivas"("encargadoId");

-- CreateIndex
CREATE INDEX "carta_items_cartaId_idx" ON "carta_items"("cartaId");

-- CreateIndex
CREATE INDEX "carta_items_deviceId_idx" ON "carta_items"("deviceId");

-- AddForeignKey
ALTER TABLE "subareas" ADD CONSTRAINT "subareas_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "departments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_subareaId_fkey" FOREIGN KEY ("subareaId") REFERENCES "subareas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "devices" ADD CONSTRAINT "devices_typeId_fkey" FOREIGN KEY ("typeId") REFERENCES "device_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cartas_responsivas" ADD CONSTRAINT "cartas_responsivas_creadoPorId_fkey" FOREIGN KEY ("creadoPorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cartas_responsivas" ADD CONSTRAINT "cartas_responsivas_responsableId_fkey" FOREIGN KEY ("responsableId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cartas_responsivas" ADD CONSTRAINT "cartas_responsivas_encargadoId_fkey" FOREIGN KEY ("encargadoId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "carta_items" ADD CONSTRAINT "carta_items_cartaId_fkey" FOREIGN KEY ("cartaId") REFERENCES "cartas_responsivas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "carta_items" ADD CONSTRAINT "carta_items_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "devices"("id") ON DELETE SET NULL ON UPDATE CASCADE;
