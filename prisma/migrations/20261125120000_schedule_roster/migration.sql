-- Rol semanal: turno por persona y fecha que sustituye al horario base ese día.
-- CreateTable
CREATE TABLE "schedule_roster_entries" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "scheduleId" TEXT,
    "restDay" BOOLEAN NOT NULL DEFAULT false,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "schedule_roster_entries_pkey" PRIMARY KEY ("id"),
    -- Exactamente uno: un horario o descanso.
    CONSTRAINT "schedule_roster_entries_shift_xor_rest" CHECK (("scheduleId" IS NOT NULL) <> "restDay")
);

-- CreateIndex
CREATE INDEX "schedule_roster_entries_date_idx" ON "schedule_roster_entries"("date");

-- CreateIndex
CREATE UNIQUE INDEX "schedule_roster_entries_userId_date_key" ON "schedule_roster_entries"("userId", "date");

-- AddForeignKey
ALTER TABLE "schedule_roster_entries" ADD CONSTRAINT "schedule_roster_entries_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schedule_roster_entries" ADD CONSTRAINT "schedule_roster_entries_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "schedules"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schedule_roster_entries" ADD CONSTRAINT "schedule_roster_entries_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
