import type { Prisma } from "@prisma/client";
import { HttpError } from "@core/middlewares/error.middleware";

type Tx = Prisma.TransactionClient;

/** Identificadores opcionales de una unidad física (serie, MAC, IP, hostname). */
export interface UnitIdentity {
  serialNumber?: string | null;
  macAddress?: string | null;
  ip?: string | null;
  hostname?: string | null;
}

/**
 * Folio de activo fijo: `PREFIJO-0001`. Fuente única del formato, para que la
 * previsualización de la carga masiva muestre exactamente los folios que se van
 * a consumir.
 */
export const formatAssetTag = (prefix: string, counter: number): string =>
  `${prefix}-${String(counter).padStart(4, "0")}`;

/**
 * Crea `quantity` unidades DISPONIBLES de un dispositivo y devuelve sus ids en
 * orden. Cada una toma su folio de activo fijo del contador de su tipo, que se
 * lee y se escribe UNA sola vez (el alta de un lote de N unidades es una sola
 * actualización del contador, no N).
 *
 * Existe para que el alta normal (`createDevice`), la entrada de stock
 * (`movementEntry`) y la carga masiva por Excel creen unidades idénticas:
 * mismo estado inicial, mismo folio y mismo formato de serie. Cualquier cambio
 * aquí vale para las tres, que es justo lo que evita que el inventario se
 * descuadre entre caminos.
 */
export const createUnits = async (
  tx: Tx,
  params: {
    typeId: string;
    deviceId: string;
    quantity: number;
    units?: UnitIdentity[];
  }
): Promise<string[]> => {
  const { typeId, deviceId } = params;
  const units: UnitIdentity[] =
    params.units && params.units.length > 0
      ? params.units
      : Array.from({ length: params.quantity }, () => ({}));
  if (units.length === 0) return [];

  const type = await tx.deviceType.findUnique({ where: { id: typeId } });
  if (!type) throw new HttpError(400, "INVALID_DEVICE_TYPE");

  let counter = type.counter;
  const unitIds: string[] = [];

  for (const unit of units) {
    counter += 1;
    const created = await tx.deviceUnit.create({
      data: {
        deviceId,
        assetTag: formatAssetTag(type.assetTagPrefix, counter),
        status: "AVAILABLE",
        serialNumber: unit.serialNumber ?? null,
        macAddress: unit.macAddress || null,
        ip: unit.ip || null,
        hostname: unit.hostname || null,
      },
    });
    unitIds.push(created.id);
  }

  // El contador se guarda con el último folio consumido: el siguiente alta
  // sigue la serie, y un choque concurrente lo resuelve el reintento
  // Serializable de quien llama.
  await tx.deviceType.update({ where: { id: typeId }, data: { counter } });

  return unitIds;
};
