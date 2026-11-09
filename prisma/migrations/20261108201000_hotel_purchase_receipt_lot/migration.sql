-- Lote generado por cada linea de recepcion de compra (ajuste demo v2: el lote se ve en compras).
ALTER TABLE "hotel_purchase_receipt_lines" ADD COLUMN "lotId" TEXT;

ALTER TABLE "hotel_purchase_receipt_lines" ADD CONSTRAINT "hotel_purchase_receipt_lines_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "hotel_lots"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "hotel_purchase_receipt_lines_lotId_idx" ON "hotel_purchase_receipt_lines"("lotId");
