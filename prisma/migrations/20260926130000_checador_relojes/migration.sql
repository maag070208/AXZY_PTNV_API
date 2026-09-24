-- Relojes checadores dados de alta desde la web: una fila por reloj (su serie),
-- con su dirección y un nombre. `url` null = dado de baja; el cursor se queda.
-- AlterTable
ALTER TABLE "checador_sync" ADD COLUMN     "nombre" TEXT,
ADD COLUMN     "url" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "checador_sync_url_key" ON "checador_sync"("url");
