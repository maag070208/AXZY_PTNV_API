-- CreateEnum
CREATE TYPE "AssignmentStatus" AS ENUM ('PENDIENTE', 'EN_PROGRESO', 'COMPLETADA');

-- CreateTable
CREATE TABLE "ticket_assignments" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "task" TEXT NOT NULL,
    "status" "AssignmentStatus" NOT NULL DEFAULT 'PENDIENTE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ticket_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ticket_assignments_ticketId_idx" ON "ticket_assignments"("ticketId");

-- CreateIndex
CREATE INDEX "ticket_assignments_userId_idx" ON "ticket_assignments"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "ticket_assignments_ticketId_userId_key" ON "ticket_assignments"("ticketId", "userId");

-- AddForeignKey
ALTER TABLE "ticket_assignments" ADD CONSTRAINT "ticket_assignments_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_assignments" ADD CONSTRAINT "ticket_assignments_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
