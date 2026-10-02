-- IVA por renglón de la factura de proveedor (NEXT_STEPS_PLAN 1.2): tasa del
-- catálogo y su valor como fotografía, para cotejar contra la orden de compra.
ALTER TABLE "supplier_invoice_lines"
  ADD COLUMN "taxRate" DECIMAL(5,4) NOT NULL DEFAULT 0,
  ADD COLUMN "taxRateId" TEXT;

ALTER TABLE "supplier_invoice_lines" ADD CONSTRAINT "supplier_invoice_lines_taxRateId_fkey" FOREIGN KEY ("taxRateId") REFERENCES "tax_rates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Integridad que Prisma no modela: la tasa es una fracción entre 0 y 1.
ALTER TABLE "supplier_invoice_lines" ADD CONSTRAINT "supplier_invoice_lines_tax_rate_check" CHECK ("taxRate" >= 0 AND "taxRate" < 1);
