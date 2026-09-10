-- CreateTable
CREATE TABLE "materials" (
    "id" TEXT NOT NULL,
    "categoria" TEXT NOT NULL,
    "modelo" TEXT NOT NULL,
    "descripcion" TEXT NOT NULL,
    "marca" TEXT,
    "stock" INTEGER NOT NULL DEFAULT 0,
    "unidad" TEXT NOT NULL DEFAULT 'PZA',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "materials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "material_history" (
    "id" TEXT NOT NULL,
    "materialId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "detail" TEXT,
    "autorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "material_history_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "materials_categoria_idx" ON "materials"("categoria");

-- CreateIndex
CREATE INDEX "materials_modelo_idx" ON "materials"("modelo");

-- CreateIndex
CREATE INDEX "material_history_materialId_idx" ON "material_history"("materialId");

-- AddForeignKey
ALTER TABLE "material_history" ADD CONSTRAINT "material_history_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "materials"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "material_history" ADD CONSTRAINT "material_history_autorId_fkey" FOREIGN KEY ("autorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
