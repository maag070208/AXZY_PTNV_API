import { Prisma, type PrismaClient } from "@prisma/client";
import { HttpError } from "@core/middlewares/error.middleware";

type Tx = Prisma.TransactionClient;

/**
 * Conflictos que se resuelven repitiendo la transacción completa: Postgres la
 * abortó por chocar con otra operación concurrente (Serializable, P2034) o dos
 * operaciones sacaron el mismo folio (`count() + 1`, P2002 sobre `number`).
 */
const isRetryableConflict = (err: unknown): boolean =>
  err instanceof Prisma.PrismaClientKnownRequestError &&
  (err.code === "P2034" ||
    ([] as string[])
      .concat((err.meta?.target as string[] | string) ?? [])
      .includes("number"));

const MAX_TX_ATTEMPTS = 3;

/**
 * Corre `fn` en una transacción Serializable con reintento ante choques
 * concurrentes. Es la regla de integridad de todo lo que mueve unidades: si el
 * choque persiste tras varios intentos responde 409 en vez de un 500.
 */
export const serializable = async <T>(
  db: PrismaClient,
  fn: (tx: Tx) => Promise<T>
): Promise<T> => {
  for (let attempt = 1; ; attempt++) {
    try {
      return await db.$transaction(fn, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
    } catch (err) {
      if (!isRetryableConflict(err)) throw err;
      if (attempt >= MAX_TX_ATTEMPTS) throw new HttpError(409, "CONCURRENT_UPDATE");
      await new Promise((resolve) => setTimeout(resolve, 25 * attempt + Math.random() * 25));
    }
  }
};
