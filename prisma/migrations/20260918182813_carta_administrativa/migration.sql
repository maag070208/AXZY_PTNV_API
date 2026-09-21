-- CreateEnum
CREATE TYPE "MotivoActaAdministrativa" AS ENUM ('INASISTENCIA', 'RETARDO', 'EBRIEDAD', 'CONDUCTA', 'INCUMPLIMIENTO', 'OTRO');

-- CreateTable
CREATE TABLE "cartas_administrativas" (
    "id" TEXT NOT NULL,
    "motivo" "MotivoActaAdministrativa" NOT NULL,
    "fechaIncidente" DATE NOT NULL,
    "descripcion" TEXT NOT NULL,
    "sancion" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,

    CONSTRAINT "cartas_administrativas_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "cartas_administrativas_userId_idx" ON "cartas_administrativas"("userId");

-- CreateIndex
CREATE INDEX "cartas_administrativas_createdAt_idx" ON "cartas_administrativas"("createdAt" DESC);

-- AddForeignKey
ALTER TABLE "cartas_administrativas" ADD CONSTRAINT "cartas_administrativas_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cartas_administrativas" ADD CONSTRAINT "cartas_administrativas_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
