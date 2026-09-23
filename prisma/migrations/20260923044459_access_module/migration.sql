-- CreateEnum
CREATE TYPE "AccessEventType" AS ENUM ('ENTRY', 'EXIT');

-- CreateEnum
CREATE TYPE "AccessLocationSource" AS ENUM ('GPS', 'SITE_ONLY', 'MANUAL');

-- CreateEnum
CREATE TYPE "AccessMethod" AS ENUM ('QR_SCAN', 'MANUAL');

-- AlterEnum
ALTER TYPE "Role" ADD VALUE 'GUARD';

-- CreateTable
CREATE TABLE "sites" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "radiusMeters" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sites_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "access_events" (
    "id" TEXT NOT NULL,
    "type" "AccessEventType" NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deviceTimestamp" TIMESTAMP(3),
    "employeeId" TEXT NOT NULL,
    "employeeNameSnapshot" TEXT,
    "employeeNumberSnapshot" TEXT,
    "guardId" TEXT,
    "siteId" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "gpsAccuracyMeters" DOUBLE PRECISION,
    "locationSource" "AccessLocationSource" NOT NULL,
    "method" "AccessMethod" NOT NULL,
    "credentialVersion" INTEGER,
    "scannedPayloadHash" TEXT,
    "clientEventId" TEXT,
    "deviceId" TEXT,
    "deviceCode" TEXT,
    "notes" TEXT,
    "voidedAt" TIMESTAMP(3),
    "voidedById" TEXT,
    "voidReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "access_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sites_name_key" ON "sites"("name");

-- CreateIndex
CREATE UNIQUE INDEX "sites_code_key" ON "sites"("code");

-- CreateIndex
CREATE UNIQUE INDEX "access_events_clientEventId_key" ON "access_events"("clientEventId");

-- CreateIndex
CREATE INDEX "access_events_occurredAt_idx" ON "access_events"("occurredAt");

-- CreateIndex
CREATE INDEX "access_events_employeeId_occurredAt_idx" ON "access_events"("employeeId", "occurredAt");

-- CreateIndex
CREATE INDEX "access_events_siteId_idx" ON "access_events"("siteId");

-- CreateIndex
CREATE INDEX "access_events_guardId_idx" ON "access_events"("guardId");

-- CreateIndex
CREATE INDEX "access_events_type_idx" ON "access_events"("type");

-- AddForeignKey
ALTER TABLE "access_events" ADD CONSTRAINT "access_events_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "access_events" ADD CONSTRAINT "access_events_guardId_fkey" FOREIGN KEY ("guardId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "access_events" ADD CONSTRAINT "access_events_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "sites"("id") ON DELETE SET NULL ON UPDATE CASCADE;
