-- CreateEnum
-- Ya lo pudo crear 20260925222428_permisos_catalogo (ver el comentario de esa migracion).
DO $$ BEGIN
    CREATE TYPE "Alcance" AS ENUM ('NINGUNO', 'PROPIO', 'AREA', 'TODO');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- CreateTable
CREATE TABLE "rol_permisos" (
    "id" TEXT NOT NULL,
    "rol" "Role" NOT NULL,
    "permiso" TEXT NOT NULL,
    "alcance" "Alcance" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rol_permisos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "rol_permisos_rol_permiso_key" ON "rol_permisos"("rol", "permiso");
