-- Proveedores completos (KITCHEN_SUPPLIERS_PLAN.md): datos fiscales, ubicación,
-- condiciones comerciales, contactos y artículos que surte (unidad de compra).

-- Fotografía de la presentación con que se pidió cada línea de OC.
ALTER TABLE "purchase_order_lines"
  ADD COLUMN "purchaseFactor" DECIMAL(12,3),
  ADD COLUMN "purchaseQuantity" DECIMAL(12,3),
  ADD COLUMN "purchaseUnit" TEXT;

ALTER TABLE "suppliers"
  ADD COLUMN "city" TEXT,
  ADD COLUMN "leadTimeDays" INTEGER,
  ADD COLUMN "legalName" TEXT,
  ADD COLUMN "locationNotes" TEXT,
  ADD COLUMN "mapsUrl" TEXT,
  ADD COLUMN "neighborhood" TEXT,
  ADD COLUMN "notes" TEXT,
  ADD COLUMN "paymentTermsDays" INTEGER,
  ADD COLUMN "postalCode" TEXT,
  ADD COLUMN "state" TEXT,
  ADD COLUMN "street" TEXT,
  ADD COLUMN "website" TEXT;

CREATE TABLE "supplier_contacts" (
    "id" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "position" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "supplier_contacts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "supplier_items" (
    "id" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "supplierCode" TEXT,
    "purchaseUnit" TEXT NOT NULL,
    "factor" DECIMAL(12,3) NOT NULL,
    "lastUnitCost" DECIMAL(12,4),
    "lastPurchasedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "supplier_items_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "supplier_contacts_supplierId_idx" ON "supplier_contacts"("supplierId");
CREATE INDEX "supplier_items_itemId_idx" ON "supplier_items"("itemId");
CREATE UNIQUE INDEX "supplier_items_supplierId_itemId_key" ON "supplier_items"("supplierId", "itemId");

ALTER TABLE "supplier_contacts" ADD CONSTRAINT "supplier_contacts_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "supplier_items" ADD CONSTRAINT "supplier_items_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "supplier_items" ADD CONSTRAINT "supplier_items_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "kitchen_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Integridad que Prisma no modela.
CREATE UNIQUE INDEX "supplier_contacts_one_primary_key" ON "supplier_contacts"("supplierId") WHERE "isPrimary";
ALTER TABLE "supplier_items" ADD CONSTRAINT "supplier_items_factor_check" CHECK ("factor" > 0);
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_purchase_factor_check" CHECK ("purchaseFactor" IS NULL OR "purchaseFactor" > 0);
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_terms_check" CHECK (("paymentTermsDays" IS NULL OR "paymentTermsDays" >= 0) AND ("leadTimeDays" IS NULL OR "leadTimeDays" >= 0));

-- El "contacto" de texto libre pasa a ser el contacto principal (con el teléfono
-- y el correo que tenía el proveedor).
INSERT INTO "supplier_contacts" ("id", "supplierId", "name", "phone", "email", "isPrimary", "updatedAt")
SELECT gen_random_uuid()::text, "id", btrim("contact"), "phone", "email", true, CURRENT_TIMESTAMP
FROM "suppliers"
WHERE "contact" IS NOT NULL AND btrim("contact") <> '';

ALTER TABLE "suppliers" DROP COLUMN "contact";

-- RFC normalizado (mayúsculas, sin espacios); si se repite, se conserva el del
-- proveedor más antiguo y a los demás se les quita (queda en sus notas).
UPDATE "suppliers" SET "rfc" = NULLIF(upper(regexp_replace("rfc", '\s', '', 'g')), '');
UPDATE "suppliers" s
SET "notes" = concat_ws(E'\n', s."notes", 'RFC duplicado retirado: ' || s."rfc"), "rfc" = NULL
WHERE s."rfc" IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM "suppliers" o
    WHERE o."rfc" = s."rfc" AND (o."createdAt", o."id") < (s."createdAt", s."id")
  );
CREATE UNIQUE INDEX "suppliers_rfc_key" ON "suppliers"("rfc");
