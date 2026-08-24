-- CreateTable
CREATE TABLE "device_history" (
    "id" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "detail" TEXT,
    "autorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "device_history_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "device_history_deviceId_idx" ON "device_history"("deviceId");

-- AddForeignKey
ALTER TABLE "device_history" ADD CONSTRAINT "device_history_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "devices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_history" ADD CONSTRAINT "device_history_autorId_fkey" FOREIGN KEY ("autorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Drop cantidad columns (no longer in schema)
ALTER TABLE "devices" DROP COLUMN IF EXISTS "cantidad";
ALTER TABLE "cartas_responsivas" DROP COLUMN IF EXISTS "cantidad";
