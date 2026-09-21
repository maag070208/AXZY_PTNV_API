-- DropForeignKey
ALTER TABLE "prestamos" DROP CONSTRAINT "prestamos_responsableId_fkey";
-- AlterTable
ALTER TABLE "prestamos" ADD COLUMN     "subareaId" TEXT,
ALTER COLUMN "responsableId" DROP NOT NULL;
-- AddForeignKey
ALTER TABLE "prestamos" ADD CONSTRAINT "prestamos_responsableId_fkey" FOREIGN KEY ("responsableId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "prestamos" ADD CONSTRAINT "prestamos_subareaId_fkey" FOREIGN KEY ("subareaId") REFERENCES "subareas"("id") ON DELETE SET NULL ON UPDATE CASCADE;
