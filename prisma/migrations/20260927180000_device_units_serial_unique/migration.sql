-- Número de serie único por unidad física, sin contar vacíos ni nulos.
-- Se normaliza con `upper(btrim(...))` para que "SN-1", " sn-1 " y "sn-1"
-- choquen; el índice es parcial para que las muchas unidades sin serie no
-- colisionen entre sí. La API normaliza (`trim`, vacío → null) al crear y
-- editar, y traduce el choque a `SERIAL_NUMBER_TAKEN`.
CREATE UNIQUE INDEX "device_units_serial_unique_key"
  ON "device_units" (upper(btrim("serialNumber")))
  WHERE coalesce(btrim("serialNumber"), '') <> '';
