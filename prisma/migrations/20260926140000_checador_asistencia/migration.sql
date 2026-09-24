-- Qué relojes arman las entradas/salidas. Los de puertas de oficina se checan
-- varias veces por turno: sus checadas se guardan, pero no cuentan.
-- AlterTable
ALTER TABLE "checador_sync" ADD COLUMN     "asistencia" BOOLEAN NOT NULL DEFAULT true;
