-- Roles dinámicos: el enum `Role` pasa a ser la tabla `roles`, administrable
-- desde `/roles`. `users.role` y `role_permissions.role` pasan de enum a texto
-- con llave foránea a `roles.key` (la clave es la identidad del rol).

-- 1. Tabla de roles
CREATE TABLE "roles" (
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "module" TEXT,
    "staff" BOOLEAN NOT NULL DEFAULT false,
    "system" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("key")
);

CREATE INDEX "roles_module_sortOrder_idx" ON "roles"("module", "sortOrder");

-- 2. Roles base (los 7 del enum anterior). `system` los protege de borrado.
INSERT INTO "roles" ("key", "name", "description", "module", "staff", "system", "active", "sortOrder", "updatedAt") VALUES
  ('ADMIN', 'ADMIN', 'Administración completa del sistema.', 'Sistema', false, true, true, 1, CURRENT_TIMESTAMP),
  ('MANAGER', 'GERENTE', 'Operación y supervisión general.', 'Operación', true, true, true, 2, CURRENT_TIMESTAMP),
  ('AREA_HEAD', 'JEFE DE ÁREA', 'Responsable de un departamento.', 'Operación', true, true, true, 3, CURRENT_TIMESTAMP),
  ('EMPLOYEE', 'EMPLEADO', 'Personal operativo.', 'Operación', true, true, true, 4, CURRENT_TIMESTAMP),
  ('HUMAN_RESOURCES', 'RECURSOS HUMANOS', 'Recursos Humanos: expedientes, asistencia y nómina.', 'RH', false, true, true, 5, CURRENT_TIMESTAMP),
  ('GUARD', 'GUARDIA', 'Opera la portería: escanea credenciales y registra entradas/salidas.', 'Operación', false, true, true, 6, CURRENT_TIMESTAMP),
  ('CHEF', 'CHEF', 'Almacén de cocina y tickets de su área.', 'Operación', false, true, true, 7, CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;

-- 3. users.role: enum -> texto con FK
ALTER TABLE "users" ALTER COLUMN "role" DROP DEFAULT;
ALTER TABLE "users" ALTER COLUMN "role" TYPE TEXT USING ("role"::text);
ALTER TABLE "users" ALTER COLUMN "role" SET DEFAULT 'EMPLOYEE';
ALTER TABLE "users"
  ADD CONSTRAINT "users_role_fkey"
  FOREIGN KEY ("role") REFERENCES "roles"("key")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- 4. role_permissions.role: enum -> texto con FK
ALTER TABLE "role_permissions" ALTER COLUMN "role" TYPE TEXT USING ("role"::text);
ALTER TABLE "role_permissions"
  ADD CONSTRAINT "role_permissions_role_fkey"
  FOREIGN KEY ("role") REFERENCES "roles"("key")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- 5. Fuera el enum
DROP TYPE "Role";
