-- Renames the time clock employee status values to English (RENAME VALUE keeps the data).
ALTER TYPE "TimeClockEmployeeStatus" RENAME VALUE 'ACTIVO' TO 'ACTIVE';
ALTER TYPE "TimeClockEmployeeStatus" RENAME VALUE 'BAJA_PENDIENTE' TO 'PENDING_REMOVAL';
ALTER TABLE "time_clock_employees" ALTER COLUMN "status" SET DEFAULT 'ACTIVE';
