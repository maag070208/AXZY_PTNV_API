-- Idempotencia: la clave (encabezado Idempotency-Key) de la petición que creó
-- el movimiento. Única: la misma petición repetida no registra otro movimiento.
ALTER TABLE "movements" ADD COLUMN "requestId" TEXT;
CREATE UNIQUE INDEX "movements_requestId_key" ON "movements"("requestId");
