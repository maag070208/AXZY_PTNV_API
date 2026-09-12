import { prismaClient } from "@core/config/database";

export const formatConsecutivo = (prefix: string, n: number): string =>
  `${prefix}${String(n).padStart(4, "0")}`;

export class CartaConsecutivoService {
  constructor(private readonly db = prismaClient) {}

  async peek() {
    const row = await this.db.consecutivo.upsert({
      where: { id: "singleton" },
      update: {},
      create: { id: "singleton", prefijo: "F-MMTO-", contador: 0 },
    });
    return formatConsecutivo(row.prefijo, row.contador + 1);
  }

  async state() {
    return this.db.consecutivo.upsert({
      where: { id: "singleton" },
      update: {},
      create: { id: "singleton", prefijo: "F-MMTO-", contador: 0 },
    });
  }

  async reset() {
    return this.db.consecutivo.upsert({
      where: { id: "singleton" },
      update: { contador: 0 },
      create: { id: "singleton", prefijo: "F-MMTO-", contador: 0 },
    });
  }
}