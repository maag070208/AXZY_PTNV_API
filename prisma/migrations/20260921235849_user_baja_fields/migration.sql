-- Track explicit user deactivation (baja lógica) outside of the implicit `active` flag.
-- Captures who deactivated the account, when, and why — for audit, future reactivation,
-- and the email that informs the user of the baja.

ALTER TABLE "users"
  ADD COLUMN "deactivatedAt" TIMESTAMP(3),
  ADD COLUMN "deactivatedById" TEXT,
  ADD COLUMN "deactivationReason" TEXT;

ALTER TABLE "users"
  ADD CONSTRAINT "users_deactivatedById_fkey"
  FOREIGN KEY ("deactivatedById") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "users_deactivatedAt_idx" ON "users"("deactivatedAt");
