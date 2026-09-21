-- AlterTable
ALTER TABLE "tipos_dispositivo" ADD COLUMN     "useEquipo" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "useIp" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "useMac" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "useSerie" BOOLEAN NOT NULL DEFAULT true;
