-- Políticas ABAC dinámicas (reglas de contexto evaluadas sobre una acción ya
-- permitida por el RBAC). Editables desde la web.

CREATE TYPE "PolicyEffect" AS ENUM ('ALLOW', 'DENY');

CREATE TABLE "policies" (
    "id" TEXT NOT NULL,
    "key" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "action" TEXT NOT NULL,
    "effect" "PolicyEffect" NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "policies_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "policies_key_key" ON "policies"("key");
CREATE INDEX "policies_action_active_priority_idx" ON "policies"("action", "active", "priority");

ALTER TABLE "policies"
  ADD CONSTRAINT "policies_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "policy_conditions" (
    "id" TEXT NOT NULL,
    "policyId" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "operator" TEXT NOT NULL,
    "value" TEXT,

    CONSTRAINT "policy_conditions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "policy_conditions_policyId_idx" ON "policy_conditions"("policyId");

ALTER TABLE "policy_conditions"
  ADD CONSTRAINT "policy_conditions_policyId_fkey"
  FOREIGN KEY ("policyId") REFERENCES "policies"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "policy_roles" (
    "policyId" TEXT NOT NULL,
    "role" TEXT NOT NULL,

    CONSTRAINT "policy_roles_pkey" PRIMARY KEY ("policyId", "role")
);

ALTER TABLE "policy_roles"
  ADD CONSTRAINT "policy_roles_policyId_fkey"
  FOREIGN KEY ("policyId") REFERENCES "policies"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "policy_roles"
  ADD CONSTRAINT "policy_roles_role_fkey"
  FOREIGN KEY ("role") REFERENCES "roles"("key")
  ON DELETE CASCADE ON UPDATE CASCADE;
