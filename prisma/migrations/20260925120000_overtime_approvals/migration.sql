-- Tiempo extra: decisión de aprobación por persona y día. La ausencia de fila = PENDIENTE.
CREATE TYPE "OvertimeApprovalStatus" AS ENUM ('APROBADO', 'RECHAZADO');

CREATE TABLE "overtime_approvals" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "status" "OvertimeApprovalStatus" NOT NULL,
    "extraMin" INTEGER NOT NULL,
    "horarioNombre" TEXT,
    "programadasMin" INTEGER,
    "note" TEXT,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "overtime_approvals_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "overtime_approvals_userId_date_key" ON "overtime_approvals"("userId", "date");
CREATE INDEX "overtime_approvals_date_idx" ON "overtime_approvals"("date");
CREATE INDEX "overtime_approvals_status_idx" ON "overtime_approvals"("status");

ALTER TABLE "overtime_approvals" ADD CONSTRAINT "overtime_approvals_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "overtime_approvals" ADD CONSTRAINT "overtime_approvals_decidedById_fkey"
  FOREIGN KEY ("decidedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
