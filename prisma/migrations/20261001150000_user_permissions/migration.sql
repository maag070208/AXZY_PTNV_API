-- Excepciones de permiso por empleado (Fase 2). Reemplazan lo que dice el rol:
-- `scope = NONE` quita el permiso. Opcional: motivo y vencimiento.

CREATE TABLE "user_permissions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "permission" TEXT NOT NULL,
    "scope" "PermissionScope" NOT NULL,
    "reason" TEXT,
    "expiresAt" TIMESTAMP(3),
    "grantedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_permissions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "user_permissions_userId_permission_key" ON "user_permissions"("userId", "permission");

ALTER TABLE "user_permissions"
  ADD CONSTRAINT "user_permissions_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "user_permissions"
  ADD CONSTRAINT "user_permissions_grantedById_fkey"
  FOREIGN KEY ("grantedById") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "user_permissions"
  ADD CONSTRAINT "user_permissions_permission_fkey"
  FOREIGN KEY ("permission") REFERENCES "permissions"("key")
  ON DELETE CASCADE ON UPDATE CASCADE;
