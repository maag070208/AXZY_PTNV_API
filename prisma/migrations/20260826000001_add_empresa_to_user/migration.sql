-- Agrega el campo empresa al modelo User para auto-rellenar
-- el campo empresa de la carta responsiva al seleccionar empleado.

ALTER TABLE "users" ADD COLUMN "empresa" VARCHAR(160);
