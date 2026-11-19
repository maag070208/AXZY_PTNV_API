-- Flujos de Blancos: sucio recogido al entregar el pedido por habitación (informativo).
ALTER TABLE "hotel_supply_request_lines" ADD COLUMN IF NOT EXISTS "dirtyCollectedQty" INTEGER;
ALTER TABLE "hotel_supply_requests" ADD COLUMN IF NOT EXISTS "dirtyCollectedAt" TIMESTAMP(3);

-- Los pedidos por habitación entregados pero sin confirmar (FULFILLED) pasan a RECEIVED: ahora la entrega los cierra.
UPDATE "hotel_supply_requests" SET "status" = 'RECEIVED' WHERE "origin" = 'ROOM_TURNOVER' AND "status" = 'FULFILLED';
