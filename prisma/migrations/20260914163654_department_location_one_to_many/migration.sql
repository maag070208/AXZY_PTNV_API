-- DropForeignKey
ALTER TABLE "department_locations" DROP CONSTRAINT "department_locations_departmentId_fkey";

-- DropForeignKey
ALTER TABLE "department_locations" DROP CONSTRAINT "department_locations_locationId_fkey";

-- AlterTable
ALTER TABLE "locations" ADD COLUMN     "departmentId" TEXT;

-- DropTable
DROP TABLE "department_locations";

-- CreateIndex
CREATE INDEX "locations_departmentId_idx" ON "locations"("departmentId");

-- AddForeignKey
ALTER TABLE "locations" ADD CONSTRAINT "locations_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

