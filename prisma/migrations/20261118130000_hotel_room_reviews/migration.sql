-- Permiso de la revisión de habitación (la matriz por rol se siembra desde seed-data al arrancar).
INSERT INTO "permissions" ("key", "module", "name", "description", "scopes", "sensitive", "active", "sortOrder", "updatedAt")
VALUES
  ('hotel_linen.room_review', 'Blancos', 'Room review', 'Count linen in a room against its par',
   ARRAY['NONE', 'AREA', 'ALL']::"PermissionScope"[], false, true, 1027, CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;

-- CreateTable
CREATE TABLE "hotel_room_reviews" (
    "id" TEXT NOT NULL,
    "folio" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "reviewedById" TEXT NOT NULL,
    "responsibleId" TEXT NOT NULL,
    "shift" TEXT NOT NULL,
    "reviewedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT,
    "totalExpected" INTEGER NOT NULL,
    "totalCounted" INTEGER NOT NULL,
    "totalMissing" INTEGER NOT NULL,
    "totalSurplus" INTEGER NOT NULL,

    CONSTRAINT "hotel_room_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hotel_room_review_lines" (
    "id" TEXT NOT NULL,
    "reviewId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "expected" INTEGER NOT NULL,
    "counted" INTEGER NOT NULL,
    "diff" INTEGER NOT NULL,
    "unexpected" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "hotel_room_review_lines_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "hotel_room_review_lines_check" CHECK ("expected" >= 0 AND "counted" >= 0 AND "diff" = "counted" - "expected")
);

-- CreateIndex
CREATE UNIQUE INDEX "hotel_room_reviews_folio_key" ON "hotel_room_reviews"("folio");
CREATE INDEX "hotel_room_reviews_roomId_reviewedAt_idx" ON "hotel_room_reviews"("roomId", "reviewedAt");
CREATE INDEX "hotel_room_reviews_responsibleId_reviewedAt_idx" ON "hotel_room_reviews"("responsibleId", "reviewedAt");
CREATE INDEX "hotel_room_reviews_reviewedAt_idx" ON "hotel_room_reviews"("reviewedAt");
CREATE UNIQUE INDEX "hotel_room_review_lines_reviewId_productId_key" ON "hotel_room_review_lines"("reviewId", "productId");
CREATE INDEX "hotel_room_review_lines_productId_idx" ON "hotel_room_review_lines"("productId");

-- AddForeignKey
ALTER TABLE "hotel_room_reviews" ADD CONSTRAINT "hotel_room_reviews_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "hotel_rooms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "hotel_room_reviews" ADD CONSTRAINT "hotel_room_reviews_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "hotel_room_reviews" ADD CONSTRAINT "hotel_room_reviews_responsibleId_fkey" FOREIGN KEY ("responsibleId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "hotel_room_review_lines" ADD CONSTRAINT "hotel_room_review_lines_reviewId_fkey" FOREIGN KEY ("reviewId") REFERENCES "hotel_room_reviews"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "hotel_room_review_lines" ADD CONSTRAINT "hotel_room_review_lines_productId_fkey" FOREIGN KEY ("productId") REFERENCES "hotel_products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
