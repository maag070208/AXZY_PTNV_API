-- Facturas de proveedor (F4): cabecera + líneas; enlazan (opcionalmente) a una
-- orden de compra y a sus renglones para el cotejo de tres vías.

CREATE TABLE "supplier_invoices" (
    "id" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "purchaseOrderId" TEXT,
    "number" TEXT NOT NULL,
    "uuid" TEXT,
    "date" DATE NOT NULL,
    "subtotal" DECIMAL(12,2),
    "tax" DECIMAL(12,2),
    "total" DECIMAL(12,2) NOT NULL,
    "status" "MovementStatus" NOT NULL DEFAULT 'ACTIVE',
    "notes" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "supplier_invoices_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "supplier_invoices_supplierId_number_key" ON "supplier_invoices"("supplierId", "number");
CREATE INDEX "supplier_invoices_supplierId_idx" ON "supplier_invoices"("supplierId");
CREATE INDEX "supplier_invoices_purchaseOrderId_idx" ON "supplier_invoices"("purchaseOrderId");

CREATE TABLE "supplier_invoice_lines" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "purchaseOrderLineId" TEXT,
    "quantity" DECIMAL(12,3) NOT NULL,
    "unitCost" DECIMAL(12,4) NOT NULL,

    CONSTRAINT "supplier_invoice_lines_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "supplier_invoice_lines_invoiceId_idx" ON "supplier_invoice_lines"("invoiceId");
CREATE INDEX "supplier_invoice_lines_itemId_idx" ON "supplier_invoice_lines"("itemId");

ALTER TABLE "supplier_invoices" ADD CONSTRAINT "supplier_invoices_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "supplier_invoices" ADD CONSTRAINT "supplier_invoices_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "purchase_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "supplier_invoices" ADD CONSTRAINT "supplier_invoices_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "supplier_invoice_lines" ADD CONSTRAINT "supplier_invoice_lines_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "supplier_invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "supplier_invoice_lines" ADD CONSTRAINT "supplier_invoice_lines_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "kitchen_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "supplier_invoice_lines" ADD CONSTRAINT "supplier_invoice_lines_purchaseOrderLineId_fkey" FOREIGN KEY ("purchaseOrderLineId") REFERENCES "purchase_order_lines"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CHECK a mano (Prisma no lo modela): cantidades positivas.
ALTER TABLE "supplier_invoice_lines" ADD CONSTRAINT "supplier_invoice_lines_quantity_check" CHECK ("quantity" > 0);
