-- CreateEnum
CREATE TYPE "HotelRoomStatus" AS ENUM ('LIMPIEZA', 'INSPECCION', 'DISPONIBLE', 'OCUPADA', 'MANTENIMIENTO', 'FUERA_SERVICIO');

-- CreateEnum
CREATE TYPE "HotelZoneKind" AS ENUM ('EDIFICIO', 'PISO', 'AREA');

-- CreateEnum
CREATE TYPE "HotelReasonKind" AS ENUM ('AJUSTE', 'BAJA', 'ESTADO_HABITACION', 'CIERRE_OC', 'INSPECCION');

-- CreateEnum
CREATE TYPE "HotelProductKind" AS ENUM ('CONSUMIBLE', 'TEXTIL', 'QUIMICO', 'EQUIPO');

-- CreateEnum
CREATE TYPE "HotelKitFrequency" AS ENUM ('CADA_LIMPIEZA', 'SOLO_CHECKOUT', 'CADA_N_DIAS');


-- CreateTable
CREATE TABLE "hotel_reasons" (
    "id" TEXT NOT NULL,
    "kind" "HotelReasonKind" NOT NULL,
    "name" TEXT NOT NULL,
    "requiresNotes" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "hotel_reasons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hotel_zones" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "HotelZoneKind" NOT NULL DEFAULT 'PISO',
    "parentId" TEXT,
    "description" TEXT,
    "requiresInspection" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hotel_zones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hotel_room_types" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "beds" INTEGER NOT NULL DEFAULT 1,
    "capacity" INTEGER NOT NULL DEFAULT 2,
    "description" TEXT,
    "requiresInspection" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "kitId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hotel_room_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hotel_rooms" (
    "id" TEXT NOT NULL,
    "zoneId" TEXT NOT NULL,
    "typeId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "status" "HotelRoomStatus" NOT NULL DEFAULT 'LIMPIEZA',
    "notes" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hotel_rooms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hotel_room_status_changes" (
    "id" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "from" "HotelRoomStatus",
    "to" "HotelRoomStatus" NOT NULL,
    "userId" TEXT,
    "reasonId" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hotel_room_status_changes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hotel_zone_supervisors" (
    "id" TEXT NOT NULL,
    "zoneId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "hotel_zone_supervisors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hotel_units" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "whole" BOOLEAN NOT NULL DEFAULT true,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "hotel_units_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hotel_product_categories" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "hotel_product_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hotel_products" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "categoryId" TEXT,
    "supplierId" TEXT,
    "unitId" TEXT NOT NULL,
    "kind" "HotelProductKind" NOT NULL DEFAULT 'CONSUMIBLE',
    "minStock" DECIMAL(12,3) NOT NULL DEFAULT 0,
    "idealStock" DECIMAL(12,3) NOT NULL DEFAULT 0,
    "overstock" DECIMAL(12,3) NOT NULL DEFAULT 0,
    "lastCost" DECIMAL(12,2),
    "lowStockAlertedAt" TIMESTAMP(3),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hotel_products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hotel_kits" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hotel_kits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hotel_kit_lines" (
    "id" TEXT NOT NULL,
    "kitId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "quantity" DECIMAL(12,3) NOT NULL,
    "frequency" "HotelKitFrequency" NOT NULL DEFAULT 'CADA_LIMPIEZA',
    "everyNDays" INTEGER,

    CONSTRAINT "hotel_kit_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_categories" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "supplier_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_category_links" (
    "supplierId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,

    CONSTRAINT "supplier_category_links_pkey" PRIMARY KEY ("supplierId","categoryId")
);

-- CreateIndex
CREATE UNIQUE INDEX "hotel_reasons_kind_name_key" ON "hotel_reasons"("kind", "name");

-- CreateIndex
CREATE UNIQUE INDEX "hotel_zones_parentId_name_key" ON "hotel_zones"("parentId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "hotel_room_types_name_key" ON "hotel_room_types"("name");

-- CreateIndex
CREATE INDEX "hotel_rooms_status_idx" ON "hotel_rooms"("status");

-- CreateIndex
CREATE UNIQUE INDEX "hotel_rooms_zoneId_number_key" ON "hotel_rooms"("zoneId", "number");

-- CreateIndex
CREATE INDEX "hotel_room_status_changes_roomId_createdAt_idx" ON "hotel_room_status_changes"("roomId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "hotel_zone_supervisors_zoneId_userId_key" ON "hotel_zone_supervisors"("zoneId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "hotel_units_name_key" ON "hotel_units"("name");

-- CreateIndex
CREATE UNIQUE INDEX "hotel_product_categories_name_key" ON "hotel_product_categories"("name");

-- CreateIndex
CREATE UNIQUE INDEX "hotel_products_code_key" ON "hotel_products"("code");

-- CreateIndex
CREATE INDEX "hotel_products_kind_idx" ON "hotel_products"("kind");

-- CreateIndex
CREATE UNIQUE INDEX "hotel_kits_name_key" ON "hotel_kits"("name");

-- CreateIndex
CREATE UNIQUE INDEX "hotel_kit_lines_kitId_productId_key" ON "hotel_kit_lines"("kitId", "productId");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_categories_name_key" ON "supplier_categories"("name");

-- AddForeignKey
ALTER TABLE "hotel_zones" ADD CONSTRAINT "hotel_zones_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "hotel_zones"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hotel_room_types" ADD CONSTRAINT "hotel_room_types_kitId_fkey" FOREIGN KEY ("kitId") REFERENCES "hotel_kits"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hotel_rooms" ADD CONSTRAINT "hotel_rooms_zoneId_fkey" FOREIGN KEY ("zoneId") REFERENCES "hotel_zones"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hotel_rooms" ADD CONSTRAINT "hotel_rooms_typeId_fkey" FOREIGN KEY ("typeId") REFERENCES "hotel_room_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hotel_room_status_changes" ADD CONSTRAINT "hotel_room_status_changes_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "hotel_rooms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hotel_room_status_changes" ADD CONSTRAINT "hotel_room_status_changes_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hotel_room_status_changes" ADD CONSTRAINT "hotel_room_status_changes_reasonId_fkey" FOREIGN KEY ("reasonId") REFERENCES "hotel_reasons"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hotel_zone_supervisors" ADD CONSTRAINT "hotel_zone_supervisors_zoneId_fkey" FOREIGN KEY ("zoneId") REFERENCES "hotel_zones"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hotel_zone_supervisors" ADD CONSTRAINT "hotel_zone_supervisors_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hotel_products" ADD CONSTRAINT "hotel_products_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "hotel_product_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hotel_products" ADD CONSTRAINT "hotel_products_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hotel_products" ADD CONSTRAINT "hotel_products_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "hotel_units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hotel_kit_lines" ADD CONSTRAINT "hotel_kit_lines_kitId_fkey" FOREIGN KEY ("kitId") REFERENCES "hotel_kits"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hotel_kit_lines" ADD CONSTRAINT "hotel_kit_lines_productId_fkey" FOREIGN KEY ("productId") REFERENCES "hotel_products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_category_links" ADD CONSTRAINT "supplier_category_links_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_category_links" ADD CONSTRAINT "supplier_category_links_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "supplier_categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Regla del plan: dos zonas raíz no pueden llamarse igual (parentId NULL no choca en el unique compuesto).
CREATE UNIQUE INDEX "hotel_zones_root_name_key" ON "hotel_zones"("name") WHERE "parentId" IS NULL;
