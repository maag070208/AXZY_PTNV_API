import { randomInt } from "crypto";
import type { Prisma } from "@prisma/client";

type Tx = Prisma.TransactionClient;

/** Código interno de 10 dígitos: escaneable como código de barras y fácil de dictar. */
export const generateDeviceCode = (): string =>
  String(randomInt(1_000_000_000, 10_000_000_000));

/** Código generado que todavía no existe en el catálogo. */
export const generateUniqueDeviceCode = async (tx: Tx): Promise<string> => {
  for (;;) {
    const code = generateDeviceCode();
    const taken = await tx.device.findUnique({ where: { code }, select: { id: true } });
    if (!taken) return code;
  }
};

/** Lo que trae el archivo o el formulario: sin espacios, en mayúsculas; vacío = sin código. */
export const normalizeDeviceCode = (value: string | null | undefined): string | null => {
  const code = (value ?? "").trim().toUpperCase();
  return code === "" ? null : code;
};
