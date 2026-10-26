-- M5: housekeeping tasks, their lines (kit frozen at creation + extras) and inspections.
-- Hand-written (not `prisma migrate dev`).

-- CreateEnum
CREATE TYPE "HotelTaskStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'FINISHED', 'CANCELLED');
CREATE TYPE "HotelCleaningType" AS ENUM ('CHECKOUT', 'STAY', 'TURNDOWN');
CREATE TYPE "HotelTaskLineSource" AS ENUM ('KIT', 'EXTRA');
CREATE TYPE "HotelInspectionResult" AS ENUM ('APPROVED', 'REJECTED');

-- CreateTable
CREATE TABLE "hotel_housekeeping_tasks" (
    "id" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "cleaningType" "HotelCleaningType" NOT NULL,
    "status" "HotelTaskStatus" NOT NULL DEFAULT 'PENDING',
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "assignedToId" TEXT,
    "kitId" TEXT,
    "kitAlert" BOOLEAN NOT NULL DEFAULT false,
    "cartWarehouseId" TEXT,
    "requiresInspection" BOOLEAN NOT NULL DEFAULT false,
    "isRework" BOOLEAN NOT NULL DEFAULT false,
    "reworkOfId" TEXT,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "movementId" TEXT,
    "linenMovementId" TEXT,
    "notes" TEXT,

    CONSTRAINT "hotel_housekeeping_tasks_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "hotel_task_lines" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "quantity" DECIMAL(12,3) NOT NULL,
    "source" "HotelTaskLineSource" NOT NULL DEFAULT 'KIT',

    CONSTRAINT "hotel_task_lines_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "hotel_inspections" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "result" "HotelInspectionResult" NOT NULL,
    "inspectorId" TEXT NOT NULL,
    "reasonId" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hotel_inspections_pkey" PRIMARY KEY ("id")
);

-- Indexes
CREATE UNIQUE INDEX "hotel_housekeeping_tasks_movementId_key" ON "hotel_housekeeping_tasks"("movementId");
CREATE UNIQUE INDEX "hotel_housekeeping_tasks_linenMovementId_key" ON "hotel_housekeeping_tasks"("linenMovementId");
CREATE INDEX "hotel_housekeeping_tasks_date_status_idx" ON "hotel_housekeeping_tasks"("date", "status");
CREATE INDEX "hotel_housekeeping_tasks_assignedToId_date_idx" ON "hotel_housekeeping_tasks"("assignedToId", "date");
CREATE UNIQUE INDEX "hotel_task_lines_taskId_productId_source_key" ON "hotel_task_lines"("taskId", "productId", "source");
CREATE UNIQUE INDEX "hotel_inspections_taskId_key" ON "hotel_inspections"("taskId");

-- One open task per room (M5 3).
CREATE UNIQUE INDEX "hotel_housekeeping_tasks_open_per_room" ON "hotel_housekeeping_tasks"("roomId")
    WHERE "status" IN ('PENDING', 'IN_PROGRESS');

-- AddForeignKey
ALTER TABLE "hotel_housekeeping_tasks" ADD CONSTRAINT "hotel_housekeeping_tasks_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "hotel_rooms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "hotel_housekeeping_tasks" ADD CONSTRAINT "hotel_housekeeping_tasks_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "hotel_housekeeping_tasks" ADD CONSTRAINT "hotel_housekeeping_tasks_kitId_fkey" FOREIGN KEY ("kitId") REFERENCES "hotel_kits"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "hotel_housekeeping_tasks" ADD CONSTRAINT "hotel_housekeeping_tasks_cartWarehouseId_fkey" FOREIGN KEY ("cartWarehouseId") REFERENCES "hotel_warehouses"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "hotel_housekeeping_tasks" ADD CONSTRAINT "hotel_housekeeping_tasks_reworkOfId_fkey" FOREIGN KEY ("reworkOfId") REFERENCES "hotel_housekeeping_tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "hotel_housekeeping_tasks" ADD CONSTRAINT "hotel_housekeeping_tasks_movementId_fkey" FOREIGN KEY ("movementId") REFERENCES "hotel_movements"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "hotel_housekeeping_tasks" ADD CONSTRAINT "hotel_housekeeping_tasks_linenMovementId_fkey" FOREIGN KEY ("linenMovementId") REFERENCES "hotel_movements"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "hotel_task_lines" ADD CONSTRAINT "hotel_task_lines_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "hotel_housekeeping_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "hotel_task_lines" ADD CONSTRAINT "hotel_task_lines_productId_fkey" FOREIGN KEY ("productId") REFERENCES "hotel_products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "hotel_inspections" ADD CONSTRAINT "hotel_inspections_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "hotel_housekeeping_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "hotel_inspections" ADD CONSTRAINT "hotel_inspections_inspectorId_fkey" FOREIGN KEY ("inspectorId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "hotel_inspections" ADD CONSTRAINT "hotel_inspections_reasonId_fkey" FOREIGN KEY ("reasonId") REFERENCES "hotel_reasons"("id") ON DELETE SET NULL ON UPDATE CASCADE;
