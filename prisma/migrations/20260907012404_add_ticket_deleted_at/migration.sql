-- DropForeignKey
ALTER TABLE "cartas_responsivas" DROP CONSTRAINT "cartas_responsivas_inventoryMovementId_fkey";

-- AlterTable
ALTER TABLE "devices" ALTER COLUMN "ip" SET DATA TYPE TEXT,
ALTER COLUMN "mac_address" SET DATA TYPE TEXT,
ALTER COLUMN "sistema_op" SET DATA TYPE TEXT,
ALTER COLUMN "ram" SET DATA TYPE TEXT,
ALTER COLUMN "almacenamiento" SET DATA TYPE TEXT;

-- AlterTable
ALTER TABLE "tickets" ADD COLUMN     "deletedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "users" ALTER COLUMN "empresa" SET DATA TYPE TEXT;
