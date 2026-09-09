CREATE TABLE "ticket_attachments" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT,
    "assignmentId" TEXT,
    "uploadedById" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'FOTO',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ticket_attachments_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ticket_attachments_storageKey_key" ON "ticket_attachments"("storageKey");
CREATE INDEX "ticket_attachments_ticketId_idx" ON "ticket_attachments"("ticketId");
CREATE INDEX "ticket_attachments_assignmentId_idx" ON "ticket_attachments"("assignmentId");
CREATE INDEX "ticket_attachments_uploadedById_idx" ON "ticket_attachments"("uploadedById");

ALTER TABLE "ticket_attachments" ADD CONSTRAINT "ticket_attachments_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ticket_attachments" ADD CONSTRAINT "ticket_attachments_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "ticket_assignments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ticket_attachments" ADD CONSTRAINT "ticket_attachments_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
