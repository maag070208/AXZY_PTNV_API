ALTER TABLE "device_types"
ADD COLUMN "fieldConfig" JSONB NOT NULL DEFAULT '{}'::jsonb;

UPDATE "device_types"
SET "fieldConfig" = CASE "code"
  WHEN 'PC' THEN '{"numeroSerie":{"enabled":true,"required":false},"nombreEquipo":{"enabled":true,"required":false},"ip":{"enabled":true,"required":false},"macAddress":{"enabled":true,"required":false},"sistemaOp":{"enabled":true,"required":false},"ram":{"enabled":true,"required":false},"almacenamiento":{"enabled":true,"required":false}}'::jsonb
  WHEN 'LAPTOP' THEN '{"numeroSerie":{"enabled":true,"required":false},"nombreEquipo":{"enabled":true,"required":false},"ip":{"enabled":true,"required":false},"macAddress":{"enabled":true,"required":false},"sistemaOp":{"enabled":true,"required":false},"ram":{"enabled":true,"required":false},"almacenamiento":{"enabled":true,"required":false}}'::jsonb
  WHEN 'TABLET' THEN '{"numeroSerie":{"enabled":true,"required":false},"nombreEquipo":{"enabled":true,"required":false},"ip":{"enabled":true,"required":false},"macAddress":{"enabled":true,"required":false},"sistemaOp":{"enabled":true,"required":false},"ram":{"enabled":true,"required":false},"almacenamiento":{"enabled":true,"required":false}}'::jsonb
  WHEN 'TELEFONO' THEN '{"numeroSerie":{"enabled":true,"required":false},"nombreEquipo":{"enabled":true,"required":false},"ip":{"enabled":false,"required":false},"macAddress":{"enabled":false,"required":false},"sistemaOp":{"enabled":false,"required":false},"ram":{"enabled":false,"required":false},"almacenamiento":{"enabled":false,"required":false}}'::jsonb
  WHEN 'IMPRESORA' THEN '{"numeroSerie":{"enabled":true,"required":false},"nombreEquipo":{"enabled":true,"required":false},"ip":{"enabled":false,"required":false},"macAddress":{"enabled":false,"required":false},"sistemaOp":{"enabled":false,"required":false},"ram":{"enabled":false,"required":false},"almacenamiento":{"enabled":false,"required":false}}'::jsonb
  ELSE '{"numeroSerie":{"enabled":false,"required":false},"nombreEquipo":{"enabled":false,"required":false},"ip":{"enabled":false,"required":false},"macAddress":{"enabled":false,"required":false},"sistemaOp":{"enabled":false,"required":false},"ram":{"enabled":false,"required":false},"almacenamiento":{"enabled":false,"required":false}}'::jsonb
END;
