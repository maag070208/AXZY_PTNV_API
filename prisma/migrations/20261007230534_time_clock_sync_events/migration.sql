-- CreateTable
CREATE TABLE "time_clock_sync_events" (
    "id" TEXT NOT NULL,
    "clockSerial" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "ok" BOOLEAN NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "finishedAt" TIMESTAMP(3) NOT NULL,
    "readCount" INTEGER NOT NULL DEFAULT 0,
    "newCount" INTEGER NOT NULL DEFAULT 0,
    "lastSerialNo" INTEGER,
    "error" TEXT,

    CONSTRAINT "time_clock_sync_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "time_clock_sync_events_clockSerial_startedAt_idx" ON "time_clock_sync_events"("clockSerial", "startedAt");

-- AddForeignKey
ALTER TABLE "time_clock_sync_events" ADD CONSTRAINT "time_clock_sync_events_clockSerial_fkey" FOREIGN KEY ("clockSerial") REFERENCES "time_clocks"("serialNumber") ON DELETE CASCADE ON UPDATE CASCADE;
