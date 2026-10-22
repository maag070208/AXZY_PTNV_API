-- Interruptor de escritura por reloj. Apagado por defecto: ningún reloj real acepta
-- altas, bajas ni huellas desde el sistema hasta que se habilite explícitamente.
ALTER TABLE "time_clocks" ADD COLUMN "writeEnabled" BOOLEAN NOT NULL DEFAULT false;
