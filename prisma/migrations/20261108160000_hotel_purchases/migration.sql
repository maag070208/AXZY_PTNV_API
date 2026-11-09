-- Blancos F6: órdenes de compra del hotel, recepción contra factura con apartado (HOLD) y solicitudes de reposición.

-- CreateEnum
CREATE TYPE "HotelPurchaseOrderStatus" AS ENUM ('DRAFT', 'APPROVED', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CLOSED', 'CANCELLED');
CREATE TYPE "HotelPurchaseHoldStatus" AS ENUM ('OPEN', 'RETURNED', 'ACCEPTED');
CREATE TYPE "HotelPurchaseRequestSource" AS ENUM ('WEEKLY_WRITEOFFS', 'LOW_STOCK', 'MANUAL');
CREATE TYPE "HotelPurchaseRequestStatus" AS ENUM ('OPEN', 'CONVERTED', 'DISMISSED');

-- CreateTable
CREATE TABLE "hotel_purchase_orders" (
    "id" TEXT NOT NULL,
    "folio" TEXT NOT NULL,
    "status" "HotelPurchaseOrderStatus" NOT NULL DEFAULT 'DRAFT',
    "supplierId" TEXT,
    "warehouseId" TEXT NOT NULL,
    "expectedDate" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "closedById" TEXT,
    "closedAt" TIMESTAMP(3),
    "closeNotes" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hotel_purchase_orders_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "hotel_purchase_order_lines" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "quantity" DECIMAL(12,3) NOT NULL,
    "receivedQuantity" DECIMAL(12,3) NOT NULL DEFAULT 0,
    "unitCost" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "taxRateId" TEXT,
    "taxRate" DECIMAL(5,4) NOT NULL DEFAULT 0,

    CONSTRAINT "hotel_purchase_order_lines_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "hotel_purchase_receipts" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "invoiceNumber" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "receivedById" TEXT NOT NULL,
    "movementId" TEXT,
    "holdMovementId" TEXT,
    "requestKey" TEXT,
    "overToleranceById" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hotel_purchase_receipts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "hotel_purchase_receipt_lines" (
    "id" TEXT NOT NULL,
    "receiptId" TEXT NOT NULL,
    "orderLineId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "receivedQty" DECIMAL(12,3) NOT NULL,
    "acceptedQty" DECIMAL(12,3) NOT NULL,
    "heldQty" DECIMAL(12,3) NOT NULL DEFAULT 0,
    "unitCost" DECIMAL(12,2) NOT NULL,
    "holdReason" TEXT,

    CONSTRAINT "hotel_purchase_receipt_lines_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "hotel_purchase_holds" (
    "id" TEXT NOT NULL,
    "receiptLineId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "lotId" TEXT NOT NULL,
    "quantity" DECIMAL(12,3) NOT NULL,
    "unitCost" DECIMAL(12,2) NOT NULL,
    "reason" TEXT NOT NULL,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "status" "HotelPurchaseHoldStatus" NOT NULL DEFAULT 'OPEN',
    "resolvedById" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "resolutionMovementId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hotel_purchase_holds_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "hotel_purchase_requests" (
    "id" TEXT NOT NULL,
    "folio" TEXT NOT NULL,
    "source" "HotelPurchaseRequestSource" NOT NULL,
    "weekFrom" TIMESTAMP(3),
    "weekTo" TIMESTAMP(3),
    "status" "HotelPurchaseRequestStatus" NOT NULL DEFAULT 'OPEN',
    "notes" TEXT,
    "createdById" TEXT,
    "purchaseOrderId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hotel_purchase_requests_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "hotel_purchase_request_lines" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "quantity" DECIMAL(12,3) NOT NULL,
    "reason" TEXT,

    CONSTRAINT "hotel_purchase_request_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "hotel_purchase_orders_folio_key" ON "hotel_purchase_orders"("folio");
CREATE INDEX "hotel_purchase_orders_status_createdAt_idx" ON "hotel_purchase_orders"("status", "createdAt");
CREATE UNIQUE INDEX "hotel_purchase_order_lines_orderId_productId_key" ON "hotel_purchase_order_lines"("orderId", "productId");
CREATE UNIQUE INDEX "hotel_purchase_receipts_requestKey_key" ON "hotel_purchase_receipts"("requestKey");
CREATE INDEX "hotel_purchase_receipts_orderId_idx" ON "hotel_purchase_receipts"("orderId");
CREATE INDEX "hotel_purchase_holds_status_dueAt_idx" ON "hotel_purchase_holds"("status", "dueAt");
CREATE UNIQUE INDEX "hotel_purchase_requests_folio_key" ON "hotel_purchase_requests"("folio");
CREATE UNIQUE INDEX "hotel_purchase_requests_source_weekFrom_key" ON "hotel_purchase_requests"("source", "weekFrom");
CREATE INDEX "hotel_purchase_requests_status_createdAt_idx" ON "hotel_purchase_requests"("status", "createdAt");
CREATE UNIQUE INDEX "hotel_purchase_request_lines_requestId_productId_key" ON "hotel_purchase_request_lines"("requestId", "productId");

-- AddForeignKey
ALTER TABLE "hotel_purchase_orders" ADD CONSTRAINT "hotel_purchase_orders_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "hotel_purchase_order_lines" ADD CONSTRAINT "hotel_purchase_order_lines_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "hotel_purchase_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "hotel_purchase_order_lines" ADD CONSTRAINT "hotel_purchase_order_lines_productId_fkey" FOREIGN KEY ("productId") REFERENCES "hotel_products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "hotel_purchase_order_lines" ADD CONSTRAINT "hotel_purchase_order_lines_taxRateId_fkey" FOREIGN KEY ("taxRateId") REFERENCES "tax_rates"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "hotel_purchase_receipts" ADD CONSTRAINT "hotel_purchase_receipts_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "hotel_purchase_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "hotel_purchase_receipt_lines" ADD CONSTRAINT "hotel_purchase_receipt_lines_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "hotel_purchase_receipts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "hotel_purchase_receipt_lines" ADD CONSTRAINT "hotel_purchase_receipt_lines_orderLineId_fkey" FOREIGN KEY ("orderLineId") REFERENCES "hotel_purchase_order_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "hotel_purchase_holds" ADD CONSTRAINT "hotel_purchase_holds_receiptLineId_fkey" FOREIGN KEY ("receiptLineId") REFERENCES "hotel_purchase_receipt_lines"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "hotel_purchase_holds" ADD CONSTRAINT "hotel_purchase_holds_productId_fkey" FOREIGN KEY ("productId") REFERENCES "hotel_products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "hotel_purchase_requests" ADD CONSTRAINT "hotel_purchase_requests_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "hotel_purchase_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "hotel_purchase_request_lines" ADD CONSTRAINT "hotel_purchase_request_lines_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "hotel_purchase_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "hotel_purchase_request_lines" ADD CONSTRAINT "hotel_purchase_request_lines_productId_fkey" FOREIGN KEY ("productId") REFERENCES "hotel_products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
