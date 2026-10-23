import { PrismaClient } from "@prisma/client";

/**
 * `users.name` guarda solo el primer nombre; el nombre completo se arma con
 * `middleName` + `paternalSurname` + `maternalSurname`. Se compone al leer para
 * que las pantallas, cartas y PDFs sigan mostrando el nombre completo.
 *
 * Las filas viejas (respaldo migrado) traen el nombre completo en `name`: si ya
 * termina con los apellidos, se devuelve tal cual para no duplicarlos.
 */
const clean = (value: string | null | undefined): string =>
  (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim();

const composeName = (user: {
  name: string;
  middleName: string | null;
  paternalSurname: string | null;
  maternalSurname: string | null;
}): string => {
  const parts = [user.name, user.middleName, user.paternalSurname, user.maternalSurname].filter(
    (part): part is string => typeof part === "string" && part.trim() !== ""
  );
  const full = parts.join(" ").replace(/\s+/g, " ").trim();
  const surnames = [user.paternalSurname, user.maternalSurname]
    .filter((part): part is string => typeof part === "string" && part.trim() !== "")
    .map(clean)
    .join(" ");
  const first = user.name.trim().replace(/\s+/g, " ");
  // Fila vieja: el nombre completo ya estaba guardado en `name`.
  return surnames && clean(first).endsWith(surnames) ? first : full;
};

/**
 * Primer nombre. En las filas viejas `name` trae el nombre completo: se le
 * quitan del final el segundo nombre y los apellidos. En las nuevas `name` ya
 * es solo el primer nombre y no se toca.
 */
const firstNameOf = (user: {
  name: string;
  middleName: string | null;
  paternalSurname: string | null;
  maternalSurname: string | null;
}): string => {
  let value = user.name.trim().replace(/\s+/g, " ");
  for (const part of [user.maternalSurname, user.paternalSurname, user.middleName]) {
    const piece = (part ?? "").trim();
    if (!piece) continue;
    const escaped = piece.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const next = value.replace(new RegExp(`\\s+${escaped}$`, "i"), "").trim();
    if (next && next !== value) value = next;
  }
  return value || user.name;
};

const base = new PrismaClient({
  log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
});

const extended = base.$extends({
  result: {
    user: {
      name: {
        needs: { name: true, middleName: true, paternalSurname: true, maternalSurname: true },
        compute: composeName,
      },
      /**
       * Primer nombre, para los formularios. En las filas viejas `name` trae el
       * nombre completo: se le quitan el segundo nombre y los apellidos del final.
       */
      firstName: {
        needs: { name: true, middleName: true, paternalSurname: true, maternalSurname: true },
        compute: firstNameOf,
      },
    },
  },
} as never);

export const prismaClient = extended as unknown as PrismaClient;
