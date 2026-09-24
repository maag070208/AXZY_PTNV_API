-- Mínimo de tiempo extra por horario (minutos). 0 = sin mínimo.
ALTER TABLE "horarios" ADD COLUMN "minimoExtraMin" INTEGER NOT NULL DEFAULT 60;
