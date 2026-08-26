-- Agrega especificaciones técnicas (TIC) a dispositivos.
-- Aplica solo para tipos PC / TABLET / LAPTOP; las columnas son opcionales.

ALTER TABLE "devices"
  ADD COLUMN "ip"              VARCHAR(45),
  ADD COLUMN "mac_address"     VARCHAR(17),
  ADD COLUMN "sistema_op"      VARCHAR(80),
  ADD COLUMN "ram"             VARCHAR(40),
  ADD COLUMN "almacenamiento"  VARCHAR(120);

CREATE INDEX "devices_mac_address_idx" ON "devices"("mac_address");
