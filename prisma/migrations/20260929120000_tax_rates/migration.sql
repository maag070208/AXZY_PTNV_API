-- Catálogo de tasas de IVA y el IVA por renglón de la orden de compra (fotografía de la tasa).

-- AlterTable
ALTER TABLE "kitchen_items" ADD COLUMN     "defaultTaxRateId" TEXT;

-- AlterTable
ALTER TABLE "purchase_order_lines" ADD COLUMN     "taxRate" DECIMAL(5,4) NOT NULL DEFAULT 0,
ADD COLUMN     "taxRateId" TEXT;

-- CreateTable
CREATE TABLE "tax_rates" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "rate" DECIMAL(5,4) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tax_rates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tax_rates_name_key" ON "tax_rates"("name");

-- AddForeignKey
ALTER TABLE "kitchen_items" ADD CONSTRAINT "kitchen_items_defaultTaxRateId_fkey" FOREIGN KEY ("defaultTaxRateId") REFERENCES "tax_rates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_taxRateId_fkey" FOREIGN KEY ("taxRateId") REFERENCES "tax_rates"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Integridad que Prisma no modela: la tasa es una fracción entre 0 y 1.
ALTER TABLE "tax_rates" ADD CONSTRAINT "tax_rates_rate_check" CHECK ("rate" >= 0 AND "rate" < 1);
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_tax_rate_check" CHECK ("taxRate" >= 0 AND "taxRate" < 1);
CREATE UNIQUE INDEX "tax_rates_rate_key" ON "tax_rates"("rate");

-- Tasas de IVA vigentes en México: 0% (alimentos básicos), 8% (región fronteriza) y 16% (general).
INSERT INTO "tax_rates" ("id", "name", "rate", "sortOrder", "updatedAt") VALUES
  ('tax_rate_iva_0', 'IVA 0%', 0, 1, CURRENT_TIMESTAMP),
  ('tax_rate_iva_8', 'IVA 8%', 0.08, 2, CURRENT_TIMESTAMP),
  ('tax_rate_iva_16', 'IVA 16%', 0.16, 3, CURRENT_TIMESTAMP)
ON CONFLICT DO NOTHING;
