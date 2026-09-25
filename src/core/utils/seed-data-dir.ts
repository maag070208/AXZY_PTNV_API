import fs from "node:fs";
import path from "node:path";

/**
 * Resuelve el directorio de fixtures `prisma/seed-data` a partir del
 * `__dirname` del llamador.
 *
 * Con ts-node los fixtures están junto al script; compilado, el seed corre
 * desde `dist/prisma/` y `tsc` no copia los .json, así que se leen del `prisma/`
 * original que la imagen sí conserva.
 */
export function resolveSeedDataDir(baseDir: string): string {
  const candidates = [
    path.join(baseDir, "seed-data"),
    path.join(baseDir, "..", "..", "prisma", "seed-data"),
  ];
  const dir = candidates.find((c) => fs.existsSync(c));
  if (!dir) {
    throw new Error(
      `No se encontró prisma/seed-data (fixtures del respaldo real). Buscado en: ${candidates.join(", ")}`
    );
  }
  return dir;
}
