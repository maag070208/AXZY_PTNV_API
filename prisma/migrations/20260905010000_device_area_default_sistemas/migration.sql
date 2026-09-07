-- Cambia el valor por defecto del área de un dispositivo nuevo a "SISTEMAS"
-- (antes "MANTENIMIENTO"). No afecta los registros existentes.
ALTER TABLE "devices" ALTER COLUMN "area" SET DEFAULT 'SISTEMAS';
