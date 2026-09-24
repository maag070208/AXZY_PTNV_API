-- Módulo de horarios: catálogo, rejilla por día y asignaciones al personal.

CREATE TABLE "horarios" (
    "id" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "toleranciaEntradaMin" INTEGER NOT NULL DEFAULT 10,
    "toleranciaSalidaMin" INTEGER NOT NULL DEFAULT 10,
    "comidaMin" INTEGER NOT NULL DEFAULT 0,
    "cruzaMedianoche" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "horarios_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "horarios_nombre_key" ON "horarios"("nombre");

CREATE TABLE "horario_dias" (
    "id" TEXT NOT NULL,
    "horarioId" TEXT NOT NULL,
    "diaSemana" INTEGER NOT NULL,
    "entrada" TEXT,
    "salida" TEXT,
    "entrada2" TEXT,
    "salida2" TEXT,
    "descanso" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "horario_dias_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "horario_dias_horarioId_diaSemana_key" ON "horario_dias"("horarioId", "diaSemana");

ALTER TABLE "horario_dias" ADD CONSTRAINT "horario_dias_horarioId_fkey" FOREIGN KEY ("horarioId") REFERENCES "horarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "horario_asignaciones" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "horarioId" TEXT NOT NULL,
    "desde" TIMESTAMP(3) NOT NULL,
    "hasta" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "creadoPorId" TEXT,
    CONSTRAINT "horario_asignaciones_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "horario_asignaciones_userId_desde_hasta_idx" ON "horario_asignaciones"("userId", "desde", "hasta");
CREATE INDEX "horario_asignaciones_horarioId_idx" ON "horario_asignaciones"("horarioId");

ALTER TABLE "horario_asignaciones" ADD CONSTRAINT "horario_asignaciones_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "horario_asignaciones" ADD CONSTRAINT "horario_asignaciones_horarioId_fkey" FOREIGN KEY ("horarioId") REFERENCES "horarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "horario_asignaciones" ADD CONSTRAINT "horario_asignaciones_creadoPorId_fkey" FOREIGN KEY ("creadoPorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
