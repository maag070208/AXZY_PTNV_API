-- Idempotente: 20260925222428_permisos_catalogo ya pudo crear todo esto (ver su comentario).
-- CreateEnum
DO $$ BEGIN
    CREATE TYPE "Alcance" AS ENUM ('NINGUNO', 'PROPIO', 'AREA', 'TODO');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- CreateTable
CREATE TABLE IF NOT EXISTS "rol_permisos" (
    "id" TEXT NOT NULL,
    "rol" "Role" NOT NULL,
    "permiso" TEXT NOT NULL,
    "alcance" "Alcance" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rol_permisos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "rol_permisos_rol_permiso_key" ON "rol_permisos"("rol", "permiso");
