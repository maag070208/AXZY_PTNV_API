-- Centro de costo (KITCHEN_SUPPLIERS_PLAN / NEXT_STEPS_PLAN 1.4): catálogo de
-- áreas que absorben el gasto, más su liga opcional en la orden de compra.

CREATE TABLE "cost_centers" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "departmentId" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cost_centers_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "cost_centers_name_key" ON "cost_centers"("name");
CREATE UNIQUE INDEX "cost_centers_code_key" ON "cost_centers"("code");
CREATE INDEX "cost_centers_departmentId_idx" ON "cost_centers"("departmentId");

ALTER TABLE "cost_centers" ADD CONSTRAINT "cost_centers_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "purchase_orders" ADD COLUMN "costCenterId" TEXT;
CREATE INDEX "purchase_orders_costCenterId_idx" ON "purchase_orders"("costCenterId");
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_costCenterId_fkey" FOREIGN KEY ("costCenterId") REFERENCES "cost_centers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
