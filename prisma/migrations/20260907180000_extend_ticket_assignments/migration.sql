-- Extender ticket_assignments: title, description (rename task), fechas
-- y tabla de comentarios por tarea.

-- Renombrar task -> description (conserva datos)
ALTER TABLE "ticket_assignments" RENAME COLUMN "task" TO "description";

-- Título (backfill desde description para filas existentes)
ALTER TABLE "ticket_assignments" ADD COLUMN "title" TEXT NOT NULL DEFAULT '';
UPDATE "ticket_assignments" SET "title" = "description";

-- Fechas opcionales
ALTER TABLE "ticket_assignments" ADD COLUMN "startDate" TIMESTAMP(3);
ALTER TABLE "ticket_assignments" ADD COLUMN "dueDate" TIMESTAMP(3);

-- Comentarios por tarea
CREATE TABLE "ticket_assignment_comments" (
    "id" TEXT NOT NULL,
    "assignmentId" TEXT NOT NULL,
    "autorId" TEXT NOT NULL,
    "texto" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ticket_assignment_comments_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ticket_assignment_comments_assignmentId_idx" ON "ticket_assignment_comments"("assignmentId");
CREATE INDEX "ticket_assignment_comments_autorId_idx" ON "ticket_assignment_comments"("autorId");

ALTER TABLE "ticket_assignment_comments" ADD CONSTRAINT "ticket_assignment_comments_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "ticket_assignments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ticket_assignment_comments" ADD CONSTRAINT "ticket_assignment_comments_autorId_fkey" FOREIGN KEY ("autorId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;