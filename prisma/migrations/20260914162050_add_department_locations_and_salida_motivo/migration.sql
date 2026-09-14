-- CreateEnum
CREATE TYPE "MaterialOutputMotivo" AS ENUM ('DANADO', 'OBSOLETO', 'EXTRAVIO', 'OTRO');

-- AlterTable
ALTER TABLE "material_outputs" ADD COLUMN     "motivo" "MaterialOutputMotivo";

-- CreateTable
CREATE TABLE "department_locations" (
    "id" TEXT NOT NULL,
    "departmentId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "department_locations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "department_locations_departmentId_locationId_key" ON "department_locations"("departmentId", "locationId");

-- AddForeignKey
ALTER TABLE "department_locations" ADD CONSTRAINT "department_locations_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "departments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "department_locations" ADD CONSTRAINT "department_locations_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "locations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

