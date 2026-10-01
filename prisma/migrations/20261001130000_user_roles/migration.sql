-- Multi-rol: `users.role` sigue siendo el rol principal; `user_roles` agrega
-- los adicionales. Los permisos efectivos son la unión de todos los roles.

CREATE TABLE "user_roles" (
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_roles_pkey" PRIMARY KEY ("userId", "role")
);

ALTER TABLE "user_roles"
  ADD CONSTRAINT "user_roles_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "user_roles"
  ADD CONSTRAINT "user_roles_role_fkey"
  FOREIGN KEY ("role") REFERENCES "roles"("key")
  ON DELETE CASCADE ON UPDATE CASCADE;
