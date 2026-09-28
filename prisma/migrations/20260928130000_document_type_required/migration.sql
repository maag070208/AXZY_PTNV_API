-- Tipos de documento obligatorios en el expediente. Hasta ahora el alta
-- reconocía la INE (frente/reverso) y el comprobante de domicilio por nombre;
-- ahora es un campo del catálogo que RH puede ajustar.
ALTER TABLE "document_types" ADD COLUMN "required" BOOLEAN NOT NULL DEFAULT false;

UPDATE "document_types"
SET "required" = true
WHERE "name" ~* '(ine.*(frente|reverso))|((frente|reverso).*ine)|domicilio';
