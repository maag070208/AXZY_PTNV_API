-- Candados de integridad del inventario: aunque el código tuviera un error,
-- la base rechaza lo que descuadraría existencias.

-- Una unidad física está, a lo más, en UN préstamo abierto (renglón sin devolver).
-- Prisma no modela índices parciales: está documentado en schema.prisma para
-- que una migración generada no lo borre.
CREATE UNIQUE INDEX "loan_item_units_open_unit_key"
  ON "loan_item_units" ("deviceUnitId")
  WHERE "returned" = false;

-- Cantidades de préstamo coherentes: lo devuelto nunca excede lo prestado.
ALTER TABLE "loan_items"
  ADD CONSTRAINT "loan_items_quantity_check" CHECK ("quantity" > 0),
  ADD CONSTRAINT "loan_items_returned_quantity_check" CHECK ("returnedQuantity" >= 0 AND "returnedQuantity" <= "quantity");

ALTER TABLE "loan_return_items"
  ADD CONSTRAINT "loan_return_items_quantity_check" CHECK ("quantity" > 0);

ALTER TABLE "movement_items"
  ADD CONSTRAINT "movement_items_quantity_check" CHECK ("quantity" > 0);
