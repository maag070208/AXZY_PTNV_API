-- Padrón de empleados desde los relojes (ver TIME_CLOCK_SYNC.md).
-- Escrita a mano: NO aplicar con `prisma migrate dev` contra la base de desarrollo.

-- CreateEnum
CREATE TYPE "TimeClockEmployeeStatus" AS ENUM ('ACTIVO', 'BAJA_PENDIENTE');

-- CreateTable: motivos de baja (catálogo administrable). `key` es el código estable.
CREATE TABLE "removal_categories" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "removal_categories_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "removal_categories_key_key" ON "removal_categories"("key");

-- Datos iniciales (editables desde el catálogo; el `key` no cambia).
INSERT INTO "removal_categories" ("id", "key", "name", "active", "createdAt", "updatedAt") VALUES
    (gen_random_uuid()::text, 'RENUNCIA', 'Renuncia', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    (gen_random_uuid()::text, 'DESPIDO', 'Despido', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    (gen_random_uuid()::text, 'CAMBIO_DE_AREA', 'Cambio de área', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    (gen_random_uuid()::text, 'CONTRATO_TERMINADO', 'Contrato terminado', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    (gen_random_uuid()::text, 'ERROR_DE_ALTA', 'Error de alta', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    (gen_random_uuid()::text, 'OTRO', 'Otro', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

-- AlterTable
ALTER TABLE "users" ADD COLUMN "deactivationCategoryId" TEXT;

-- AlterTable
ALTER TABLE "time_clock_employees"
    ADD COLUMN "status" "TimeClockEmployeeStatus" NOT NULL DEFAULT 'ACTIVO',
    ADD COLUMN "missingRuns" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "missingSince" TIMESTAMP(3),
    ADD COLUMN "reappearedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "time_clock_roster_entries" (
    "id" TEXT NOT NULL,
    "clockSerial" TEXT NOT NULL,
    "employeeNumber" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "time_clock_roster_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "time_clock_roster_runs" (
    "id" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "finishedAt" TIMESTAMP(3) NOT NULL,
    "ok" BOOLEAN NOT NULL,
    "suspicious" BOOLEAN NOT NULL DEFAULT false,
    "added" INTEGER NOT NULL DEFAULT 0,
    "removalPending" INTEGER NOT NULL DEFAULT 0,
    "cancelled" INTEGER NOT NULL DEFAULT 0,
    "reappeared" INTEGER NOT NULL DEFAULT 0,
    "perClock" JSONB NOT NULL,

    CONSTRAINT "time_clock_roster_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "time_clock_roster_entries_clockSerial_employeeNumber_key" ON "time_clock_roster_entries"("clockSerial", "employeeNumber");

-- CreateIndex
CREATE INDEX "time_clock_roster_entries_employeeNumber_idx" ON "time_clock_roster_entries"("employeeNumber");

-- CreateIndex
CREATE INDEX "time_clock_roster_runs_startedAt_idx" ON "time_clock_roster_runs"("startedAt");

-- CreateIndex
CREATE INDEX "users_deactivationCategoryId_idx" ON "users"("deactivationCategoryId");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_deactivationCategoryId_fkey" FOREIGN KEY ("deactivationCategoryId") REFERENCES "removal_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "time_clock_roster_entries" ADD CONSTRAINT "time_clock_roster_entries_clockSerial_fkey" FOREIGN KEY ("clockSerial") REFERENCES "time_clocks"("serialNumber") ON DELETE CASCADE ON UPDATE CASCADE;
