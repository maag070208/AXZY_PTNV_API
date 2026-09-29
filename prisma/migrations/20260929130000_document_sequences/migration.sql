-- Secuencia de folios por tipo de documento y año (OC-2026-0001). El `last` se
-- incrementa de forma atómica dentro de la transacción de creación.
CREATE TABLE "document_sequences" (
    "type" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "last" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "document_sequences_pkey" PRIMARY KEY ("type","year")
);
