-- Posición de la persona en el Excel operativo de nómina (1..N).
-- La pre-nómina ordena por esta columna (nulls al final) y luego por nombre.
ALTER TABLE "users" ADD COLUMN "payrollOrder" INTEGER;
