-- Checador: vínculo explícito entre el número de empleado del reloj y un usuario.

-- CreateTable
CREATE TABLE "checador_empleados" (
    "numeroEmpleado" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "vinculadoPorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "checador_empleados_pkey" PRIMARY KEY ("numeroEmpleado")
);

-- CreateIndex
CREATE INDEX "checador_empleados_userId_idx" ON "checador_empleados"("userId");

-- AddForeignKey
ALTER TABLE "checador_empleados" ADD CONSTRAINT "checador_empleados_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checador_empleados" ADD CONSTRAINT "checador_empleados_vinculadoPorId_fkey" FOREIGN KEY ("vinculadoPorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

