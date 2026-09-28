import { Prisma } from "@prisma/client";
import { prismaClient } from "@core/config/database";
import { HttpError } from "@core/middlewares/error.middleware";
import { label, systemLanguage, t, type ErrorCode } from "@core/i18n";
import { broadcastDashboardEvent } from "@core/services/ably";
import { ci } from "@core/utils/table";
import type { AuditPort } from "../../audit/models/entity/audit.entity";
import { ledgerDelta } from "./ledger";
import type {
  Condition,
  CreateDeviceInput,
  CreateMovementInput,
  CreateDeviceTypeInput,
  DeviceUnitStatus,
  MovementItemInput,
  MovementType,
  UpdateDeviceInput,
  UpdateLoanInput,
  UpdateDeviceTypeInput,
  UpdateUnitInput,
} from "../models/entity/inventory.entity";

type Tx = Prisma.TransactionClient;

const CONDITION_TO_AVAILABLE: Condition[] = ["GOOD", "FAIR"];

const conditionToStatus = (condition?: Condition | null): DeviceUnitStatus => {
  if (!condition) return "AVAILABLE";
  if (CONDITION_TO_AVAILABLE.includes(condition)) return "AVAILABLE";
  if (condition === "BROKEN") return "RETIRED";
  return "DAMAGED";
};

/** Número de serie canónico: sin espacios sobrantes y vacío → null (el índice único lo ignora). */
const normalizeSerial = (value?: string | null): string | null => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
};

/**
 * Conflictos que se resuelven repitiendo la transacción completa: Postgres la
 * abortó por chocar con otra operación concurrente (Serializable, P2034) o dos
 * operaciones sacaron el mismo folio (`count() + 1`, P2002 sobre `number`).
 */
const isRetryableConflict = (err: unknown): boolean =>
  err instanceof Prisma.PrismaClientKnownRequestError &&
  (err.code === "P2034" ||
    (err.code === "P2002" && ([] as string[]).concat((err.meta?.target as string[] | string) ?? []).includes("number")));

const MAX_TX_ATTEMPTS = 3;

/** Un renglón del historial de una unidad física (ver `unitHistory`). */
interface UnitHistoryEntry {
  kind: "MOVEMENT" | "LOAN" | "RETURN" | "AUDIT";
  date: Date;
  type?: string;
  status?: string;
  author?: string | null;
  condition?: Condition | null;
  reason?: string | null;
  notes?: string | null;
  movementId?: string;
  loanId?: string;
  number?: string;
  loanNumber?: string;
  returned?: boolean;
  custodian?: string | null;
  department?: string | null;
  action?: string;
  metadata?: Prisma.JsonValue | null;
}


const UNIT_SELECT = {
  id: true,
  assetTag: true,
  serialNumber: true,
  macAddress: true,
  ip: true,
  hostname: true,
  area: true,
  status: true,
  departmentId: true,
  deviceId: true,
} as const;

export class InventoryService {
  constructor(
    private readonly auditPort: AuditPort,
    private readonly db = prismaClient
  ) {}

  // ---------------------------------------------------------------------------
  // Tipos de dispositivo
  // ---------------------------------------------------------------------------
  listTypes() {
    return this.db.deviceType.findMany({
      orderBy: { name: "asc" },
      include: { _count: { select: { devices: true } } },
    });
  }

  async createType(input: CreateDeviceTypeInput) {
    return this.db.deviceType.create({ data: input });
  }

  async updateType(id: string, input: UpdateDeviceTypeInput) {
    const existing = await this.db.deviceType.findUnique({ where: { id } });
    if (!existing) throw new HttpError(404, "DEVICE_TYPE_NOT_FOUND");
    return this.db.deviceType.update({ where: { id }, data: input });
  }

  async deleteType(id: string) {
    const count = await this.db.device.count({ where: { typeId: id } });
    if (count > 0) {
      throw new HttpError(409, "DEVICE_TYPE_HAS_DEVICES");
    }
    return this.db.deviceType.delete({ where: { id } });
  }

  // ---------------------------------------------------------------------------
  // Dispositivos
  // ---------------------------------------------------------------------------
  listDevices(filters: { typeId?: string; q?: string } = {}) {
    const where: Prisma.DeviceWhereInput = {};
    if (filters.typeId) where.typeId = filters.typeId;
    if (filters.q) {
      where.OR = [
        { name: { contains: filters.q, mode: "insensitive" } },
        { brand: { contains: filters.q, mode: "insensitive" } },
        { model: { contains: filters.q, mode: "insensitive" } },
      ];
    }
    return this.db.device.findMany({
      where,
      orderBy: { name: "asc" },
      include: { type: true },
    });
  }

  // Lista de dispositivos con existencias por estado (para tablas).
  async listDevicesWithStock(filters: { typeId?: string; q?: string } = {}) {
    const devices = await this.listDevices(filters);
    const ids = devices.map((d) => d.id);
    if (ids.length === 0) return devices;

    const rows = await this.db.deviceUnit.groupBy({
      by: ["deviceId", "status"],
      where: { deviceId: { in: ids } },
      _count: { _all: true },
    });

    const map: Record<string, Record<string, number>> = {};
    for (const r of rows) {
      (map[r.deviceId] ??= {})[r.status] = r._count._all;
    }

    return devices.map((d) => {
      const ex = map[d.id] ?? {};
      const total =
        (ex.AVAILABLE ?? 0) +
        (ex.ON_LOAN ?? 0) +
        (ex.DAMAGED ?? 0) +
        (ex.IN_MAINTENANCE ?? 0) +
        (ex.RETIRED ?? 0);
      return {
        ...d,
        stock: {
          total,
          AVAILABLE: ex.AVAILABLE ?? 0,
          ON_LOAN: ex.ON_LOAN ?? 0,
          DAMAGED: ex.DAMAGED ?? 0,
          IN_MAINTENANCE: ex.IN_MAINTENANCE ?? 0,
          RETIRED: ex.RETIRED ?? 0,
        },
      };
    });
  }

  getDevice(id: string) {
    return this.db.device.findUnique({
      where: { id },
      include: { type: true },
    });
  }

  async createDevice(input: CreateDeviceInput, authorId?: string) {
    if (!authorId) throw new HttpError(400, "USER_ID_REQUIRED");
    const normalizedUnits = (input.units ?? []).map((u) => ({
      ...u,
      serialNumber: normalizeSerial(u.serialNumber),
    }));
    try {
      return await this.db.$transaction(
        async (tx) => {
          const type = await tx.deviceType.findUnique({
            where: { id: input.typeId },
          });
          if (!type || !type.active) {
            throw new HttpError(400, "INVALID_DEVICE_TYPE");
          }

          const device = await tx.device.create({
            data: {
              typeId: input.typeId,
              name: input.name,
              brand: input.brand,
              model: input.model,
              description: input.description,
              notes: input.notes,
            },
          });

          const unitsData =
            normalizedUnits.length > 0
              ? normalizedUnits
              : Array.from({ length: input.initialQuantity ?? 0 }, () => ({} as { serialNumber?: string | null; macAddress?: string; ip?: string; hostname?: string }));

          const unitIds: string[] = [];
          let counter = type.counter;
          for (let i = 0; i < unitsData.length; i++) {
            counter += 1;
            const assetTag = `${type.assetTagPrefix}-${String(counter).padStart(4, "0")}`;
            const unit = await tx.deviceUnit.create({
              data: {
                deviceId: device.id,
                assetTag,
                status: "AVAILABLE",
                serialNumber: unitsData[i].serialNumber,
                macAddress: unitsData[i].macAddress || null,
                ip: unitsData[i].ip || null,
                hostname: unitsData[i].hostname || null,
              },
            });
            unitIds.push(unit.id);
          }
          await tx.deviceType.update({
            where: { id: type.id },
            data: { counter },
          });

          // Un dispositivo sin unidades no genera movimiento: el renglón no
          // puede quedar en cantidad 0 (CHECK de movement_items).
          if (unitIds.length > 0) {
            await tx.movement.create({
              data: {
                type: "STOCK_IN",
                createdById: authorId,
                reason: t("inventory.initialStock", {}, await systemLanguage()),
                items: {
                  create: [
                    {
                      deviceId: device.id,
                      quantity: unitIds.length,
                      units: { create: unitIds.map((deviceUnitId) => ({ deviceUnitId })) },
                    },
                  ],
                },
              },
            });
          }

          return device;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
      );
    } catch (err) {
      await this.raiseIfSerialTaken(
        err,
        normalizedUnits.map((u) => u.serialNumber).filter((s): s is string => !!s)
      );
      throw err;
    }
  }

  /**
   * Traduce el choque del índice único de serie (P2002) a un 409 legible, con
   * el activo fijo que ya tiene ese número. Se consulta fuera de la transacción
   * abortada porque en Postgres la violación deja la transacción inservible; y
   * se confirma por búsqueda —no por `meta.target`— porque el índice es parcial
   * y Prisma lo reporta con el nombre del índice, no con la columna.
   */
  private async raiseIfSerialTaken(err: unknown, serials: string[]): Promise<void> {
    if (!(err instanceof Prisma.PrismaClientKnownRequestError) || err.code !== "P2002") return;
    for (const serial of serials) {
      const clash = await this.db.deviceUnit.findFirst({
        where: { serialNumber: { equals: serial, mode: "insensitive" } },
        select: { assetTag: true, serialNumber: true },
      });
      if (clash) {
        throw new HttpError(409, "SERIAL_NUMBER_TAKEN", {
          serial: clash.serialNumber ?? serial,
          assetTag: clash.assetTag,
        });
      }
    }
  }

  async updateDevice(id: string, input: UpdateDeviceInput) {
    const existing = await this.db.device.findUnique({ where: { id } });
    if (!existing) throw new HttpError(404, "DEVICE_NOT_FOUND");
    return this.db.device.update({ where: { id }, data: input });
  }

  /**
   * Edita los datos de identificación de una unidad (serie, MAC, IP, hostname,
   * área). El departamento NO se toca aquí: se cambia con un traspaso, que
   * queda en el kardex y en la bitácora. Los cambios reales se auditan.
   */
  async updateUnit(id: string, input: UpdateUnitInput, authorId?: string) {
    const serial = input.serialNumber !== undefined ? normalizeSerial(input.serialNumber) : undefined;
    const data: Prisma.DeviceUnitUpdateInput = {};
    if (serial !== undefined) data.serialNumber = serial;
    if (input.macAddress !== undefined) data.macAddress = input.macAddress || null;
    if (input.ip !== undefined) data.ip = input.ip || null;
    if (input.hostname !== undefined) data.hostname = input.hostname || null;
    if (input.area !== undefined) data.area = input.area || "SISTEMAS";
    try {
      return await this.db.$transaction(async (tx) => {
        const existing = await tx.deviceUnit.findUnique({ where: { id } });
        if (!existing) throw new HttpError(404, "UNIT_NOT_FOUND");
        if (Object.keys(data).length === 0) return existing;
        const updated = await tx.deviceUnit.update({ where: { id }, data });
        await this.auditPort.createLog(
          {
            action: "DEVICE_UNIT_UPDATED",
            entityType: "DeviceUnit",
            entityId: id,
            userId: authorId,
            previousState: {
              serialNumber: existing.serialNumber,
              macAddress: existing.macAddress,
              ip: existing.ip,
              hostname: existing.hostname,
              area: existing.area,
            },
            newState: {
              serialNumber: updated.serialNumber,
              macAddress: updated.macAddress,
              ip: updated.ip,
              hostname: updated.hostname,
              area: updated.area,
            },
          },
          tx
        );
        return updated;
      });
    } catch (err) {
      await this.raiseIfSerialTaken(err, serial ? [serial] : []);
      throw err;
    }
  }

  async deleteDevice(id: string) {
    const count = await this.db.deviceUnit.count({ where: { deviceId: id } });
    if (count > 0) {
      throw new HttpError(409, "DEVICE_HAS_UNITS");
    }
    return this.db.device.delete({ where: { id } });
  }

  // ---------------------------------------------------------------------------
  // Existencias y Kardex
  // ---------------------------------------------------------------------------
  async stock(deviceId: string) {
    const rows = await this.db.deviceUnit.groupBy({
      by: ["status"],
      where: { deviceId },
      _count: { _all: true },
    });
    const map: Record<DeviceUnitStatus, number> = {
      AVAILABLE: 0,
      ON_LOAN: 0,
      DAMAGED: 0,
      IN_MAINTENANCE: 0,
      RETIRED: 0,
    };
    for (const r of rows) map[r.status as DeviceUnitStatus] = r._count._all;
    const active = map.AVAILABLE + map.ON_LOAN + map.DAMAGED + map.IN_MAINTENANCE;
    return { ...map, active, historical: active + map.RETIRED };
  }

  async units(deviceId: string) {
    return this.db.deviceUnit.findMany({
      where: { deviceId },
      orderBy: { assetTag: "asc" },
      select: UNIT_SELECT,
    });
  }

  /**
   * Busca unidades por lo que trae impreso el equipo: activo fijo, número de
   * serie o nombre de equipo. En la web se llega al equipo navegando el
   * catálogo; en la app se teclea o escanea el folio, así que la búsqueda
   * devuelve ya resuelto el dispositivo y su tipo para no encadenar llamadas.
   */
  async searchUnits(q: string, limit: number) {
    const term = q.trim();
    if (!term) return [];
    return this.db.deviceUnit.findMany({
      where: {
        OR: [
          { assetTag: ci(term) },
          { serialNumber: ci(term) },
          { hostname: ci(term) },
        ],
      },
      orderBy: { assetTag: "asc" },
      take: Math.min(Math.max(limit, 1), 50),
      select: {
        ...UNIT_SELECT,
        department: { select: { id: true, name: true } },
        device: {
          select: {
            id: true,
            name: true,
            brand: true,
            model: true,
            type: { select: { id: true, name: true, assetTagPrefix: true } },
          },
        },
      },
    });
  }

  async stockLedger(deviceId: string) {
    const device = await this.db.device.findUnique({
      where: { id: deviceId },
      include: { type: true },
    });
    if (!device) throw new HttpError(404, "DEVICE_NOT_FOUND");

    const items = await this.db.movementItem.findMany({
      where: { deviceId },
      orderBy: [{ movement: { date: "asc" } }, { movement: { createdAt: "asc" } }],
      include: {
        movement: {
          include: {
            createdBy: { select: { id: true, name: true } },
            reversalOf: { select: { type: true } },
          },
        },
      },
    });

    // Saldo = existencia disponible (ver `ledgerDelta`).
    let balance = 0;
    const rows = items.map((d) => {
      const delta = ledgerDelta(d.movement.type, d.quantity, d.condition, d.movement.reversalOf?.type);
      balance += delta;
      return {
        date: d.movement.date,
        type: d.movement.type,
        stockIn: Math.max(delta, 0),
        stockOut: Math.max(-delta, 0),
        balance,
        condition: (d.condition ?? null) as any,
        reason: d.movement.reason,
        notes: d.movement.notes,
        user: d.movement.createdBy?.name ?? null,
      };
    });

    return { device, stock: await this.stock(deviceId), rows };
  }

  /**
   * Historial de una pieza: préstamos, devoluciones, movimientos y bitácora,
   * unidos y ordenados por fecha. Sirve para rastrear un activo fijo o una
   * serie sin cruzar tablas a mano.
   */
  async unitHistory(id: string) {
    const unit = await this.db.deviceUnit.findUnique({
      where: { id },
      select: {
        ...UNIT_SELECT,
        department: { select: { id: true, name: true } },
        device: {
          select: {
            id: true,
            name: true,
            brand: true,
            model: true,
            type: { select: { id: true, name: true } },
          },
        },
      },
    });
    if (!unit) throw new HttpError(404, "UNIT_NOT_FOUND");

    const [movementUnits, loanUnits, returnUnits, auditLogs] = await Promise.all([
      this.db.movementItemUnit.findMany({
        where: { deviceUnitId: id },
        include: {
          item: {
            include: { movement: { include: { createdBy: { select: { id: true, name: true } } } } },
          },
        },
      }),
      this.db.loanItemUnit.findMany({
        where: { deviceUnitId: id },
        include: {
          loanItem: {
            include: {
              loan: {
                include: {
                  custodian: { select: { id: true, name: true } },
                  department: { select: { id: true, name: true } },
                },
              },
            },
          },
        },
      }),
      this.db.loanReturnItemUnit.findMany({
        where: { deviceUnitId: id },
        include: {
          loanReturnItem: {
            include: {
              loanReturn: {
                include: {
                  loan: {
                    select: {
                      id: true,
                      number: true,
                      custodian: { select: { id: true, name: true } },
                      department: { select: { id: true, name: true } },
                    },
                  },
                },
              },
            },
          },
        },
      }),
      this.db.auditLog.findMany({
        where: { entityType: "DeviceUnit", entityId: id },
        orderBy: { createdAt: "asc" },
        select: { action: true, userName: true, metadata: true, createdAt: true },
      }),
    ]);

    const history: UnitHistoryEntry[] = [
      ...movementUnits.map((mu) => ({
        kind: "MOVEMENT" as const,
        date: mu.item.movement.date,
        type: mu.item.movement.type as string,
        status: mu.item.movement.status as string,
        author: mu.item.movement.createdBy?.name ?? null,
        condition: (mu.item.condition ?? null) as Condition | null,
        reason: mu.item.movement.reason,
        notes: mu.item.notes ?? mu.item.movement.notes,
        movementId: mu.item.movement.id,
      })),
      ...loanUnits.map((lu) => ({
        kind: "LOAN" as const,
        date: lu.loanItem.loan.date,
        type: "LOAN",
        status: lu.loanItem.loan.status as string,
        returned: lu.returned,
        number: lu.loanItem.loan.number,
        loanId: lu.loanItem.loan.id,
        custodian: lu.loanItem.loan.custodian?.name ?? null,
        department: lu.loanItem.loan.department?.name ?? null,
      })),
      ...returnUnits.map((ru) => ({
        kind: "RETURN" as const,
        date: ru.loanReturnItem.loanReturn.date,
        type: "RETURN",
        number: ru.loanReturnItem.loanReturn.number,
        loanNumber: ru.loanReturnItem.loanReturn.loan.number,
        loanId: ru.loanReturnItem.loanReturn.loan.id,
        condition: ru.loanReturnItem.condition as Condition,
        notes: ru.loanReturnItem.notes,
      })),
      ...auditLogs.map((log) => ({
        kind: "AUDIT" as const,
        date: log.createdAt,
        action: log.action,
        author: log.userName ?? null,
        metadata: log.metadata,
      })),
    ];
    history.sort((a, b) => a.date.getTime() - b.date.getTime());
    return { unit, history };
  }

  // ---------------------------------------------------------------------------
  // Transacciones
  // ---------------------------------------------------------------------------

  /**
   * Toda operación que mueve unidades corre Serializable: dos operaciones sobre
   * las mismas unidades no pueden intercalarse. Si Postgres aborta una por el
   * choque, se repite desde cero (lee otra vez el estado real); tras varios
   * intentos responde 409 en vez de un 500.
   */
  private async serializable<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    for (let attempt = 1; ; attempt++) {
      try {
        return await this.db.$transaction(fn, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      } catch (err) {
        if (!isRetryableConflict(err)) throw err;
        if (attempt >= MAX_TX_ATTEMPTS) throw new HttpError(409, "CONCURRENT_UPDATE");
        await new Promise((resolve) => setTimeout(resolve, 25 * attempt + Math.random() * 25));
      }
    }
  }

  /**
   * Candado optimista por unidad: cambia las unidades solo si TODAS siguen en
   * el estado `from`. Si alguna ya cambió (otra operación la tomó), aborta con
   * 409 y la transacción completa se deshace: nunca queda una unidad en dos
   * préstamos ni un conteo a medias.
   */
  private async transitionUnits(
    tx: Tx,
    ids: string[],
    from: DeviceUnitStatus,
    data: Prisma.DeviceUnitUncheckedUpdateManyInput
  ) {
    if (ids.length === 0) return;
    const { count } = await tx.deviceUnit.updateMany({ where: { id: { in: ids }, status: from }, data });
    if (count !== ids.length) throw new HttpError(409, "UNITS_CHANGED");
  }

  /** Unidades pedidas por id: existen, son del dispositivo y están en `status`. */
  private async requireUnits(tx: Tx, deviceId: string, unitIds: string[], status: DeviceUnitStatus) {
    const units = await tx.deviceUnit.findMany({ where: { id: { in: unitIds } }, select: UNIT_SELECT });
    if (units.length !== unitIds.length) throw new HttpError(404, "DEVICE_UNIT_NOT_FOUND");
    for (const unit of units) {
      if (unit.deviceId !== deviceId) throw new HttpError(400, "UNIT_DEVICE_MISMATCH");
      if (unit.status !== status) {
        throw new HttpError(409, "UNIT_UNEXPECTED_STATUS", { assetTag: unit.assetTag, status: unit.status, expected: status });
      }
    }
    // En el orden del activo fijo, como las que elige la API.
    return units.sort((a, b) => a.assetTag.localeCompare(b.assetTag));
  }

  /** Unidades a prestar: las indicadas o, si solo viene cantidad, las primeras disponibles. */
  private async unitsToLoan(tx: Tx, item: { deviceId: string; quantity: number; unitIds?: string[] }) {
    if (item.unitIds) return this.requireUnits(tx, item.deviceId, item.unitIds, "AVAILABLE");
    const units = await this.selectUnits(tx, item.deviceId, "AVAILABLE", item.quantity);
    if (units.length < item.quantity) {
      throw new HttpError(409, "NOT_ENOUGH_UNITS", { deviceId: item.deviceId, required: item.quantity, available: units.length });
    }
    return units;
  }

  /**
   * Baja de una unidad por salida de material (se desecha), dentro de la
   * transacción de quien la llama. Solo desde DISPONIBLE o DAÑADA: una unidad
   * prestada o en mantenimiento primero se devuelve. Registra un RETIREMENT con
   * la unidad exacta (condición POOR si venía dañada: no resta disponibles en el
   * kardex). Si ya estaba dada de baja no hace nada.
   */
  async retireUnitForMaterialOutput(tx: Tx, deviceUnitId: string, authorId: string | undefined, reason: string) {
    if (!authorId) throw new HttpError(400, "USER_ID_REQUIRED");
    const unit = await tx.deviceUnit.findUnique({ where: { id: deviceUnitId }, select: UNIT_SELECT });
    if (!unit) throw new HttpError(404, "DEVICE_UNIT_NOT_FOUND");
    if (unit.status === "RETIRED") return null;
    if (unit.status !== "AVAILABLE" && unit.status !== "DAMAGED") {
      throw new HttpError(409, "UNIT_UNEXPECTED_STATUS", { assetTag: unit.assetTag, status: unit.status, expected: "AVAILABLE" });
    }
    await this.transitionUnits(tx, [unit.id], unit.status, { status: "RETIRED" });
    const movement = await tx.movement.create({
      data: {
        type: "RETIREMENT",
        createdById: authorId,
        reason,
        items: {
          create: [
            {
              deviceId: unit.deviceId,
              quantity: 1,
              condition: unit.status === "DAMAGED" ? "POOR" : null,
              units: { create: [{ deviceUnitId: unit.id }] },
            },
          ],
        },
      },
    });
    await this.audit(tx, "MOVEMENT_RETIREMENT", movement.id, authorId, { reason, items: [{ deviceUnitId }] });
    this.broadcast("RETIREMENT", 1, movement.id, unit.deviceId);
    return movement;
  }

  // ---------------------------------------------------------------------------
  // Movimientos
  // ---------------------------------------------------------------------------
  /**
   * Registra un movimiento. Con `requestId` (Idempotency-Key) es idempotente:
   * si esa petición ya se registró —doble clic, reintento tras un corte— se
   * devuelve el mismo movimiento sin repetir nada. El índice único de la base
   * cubre también dos peticiones iguales al mismo tiempo: la segunda choca,
   * se deshace completa y devuelve la primera.
   */
  async registerMovement(input: CreateMovementInput, authorId?: string) {
    if (!authorId) throw new HttpError(400, "USER_ID_REQUIRED");
    const { requestId } = input;
    if (requestId) {
      const previous = await this.movementByRequest(requestId, authorId);
      if (previous) return previous;
    }
    try {
      return await this.serializable(async (tx) => {
        const movement = await this.applyMovement(tx, input, authorId);
        if (!requestId) return movement;
        return tx.movement.update({ where: { id: movement.id }, data: { requestId }, include: { items: true } });
      });
    } catch (err) {
      // La misma petición llegó dos veces al mismo tiempo: la que perdió choca
      // con la clave (índice único) o con lo que la otra ya hizo (p. ej. la
      // unidad ya prestada). Si la ganadora ya registró su movimiento, esta
      // petición es un duplicado y devuelve ese resultado.
      if (requestId) {
        const previous = await this.movementByRequest(requestId, authorId);
        if (previous) return previous;
      }
      throw err;
    }
  }

  /** Movimiento ya registrado con esa clave; la clave es de quien la usó. */
  private async movementByRequest(requestId: string, authorId: string) {
    const previous = await this.db.movement.findUnique({ where: { requestId }, include: { items: true } });
    if (previous && previous.createdById !== authorId) throw new HttpError(409, "IDEMPOTENCY_KEY_REUSED");
    return previous;
  }

  private async applyMovement(tx: Tx, input: CreateMovementInput, authorId: string) {
    switch (input.type) {
      case "STOCK_IN":
      case "ADJUSTMENT_IN":
        return this.movementEntry(tx, input, authorId);
      case "RETIREMENT":
      case "ADJUSTMENT_OUT":
        return this.movementRetirement(tx, input, authorId);
      case "LOAN":
        return this.movementLoan(tx, input, authorId);
      case "RETURN":
        return this.movementLoanReturn(tx, input, authorId);
      case "TRANSFER":
        return this.movementTransfer(tx, input, authorId);
      case "MAINTENANCE_IN":
        return this.movementMaintenanceIn(tx, input, authorId);
      case "MAINTENANCE_OUT":
        return this.movementMaintenanceOut(tx, input, authorId);
      case "REVERSAL":
        return this.movementReversion(tx, input, authorId);
      default:
        throw new HttpError(400, "UNSUPPORTED_MOVEMENT_TYPE");
    }
  }

  private async nextActive(tx: Tx, typeId: string) {
    const type = await tx.deviceType.findUnique({ where: { id: typeId } });
    if (!type) throw new HttpError(400, "INVALID_DEVICE_TYPE");
    const counter = type.counter + 1;
    await tx.deviceType.update({ where: { id: typeId }, data: { counter } });
    return `${type.assetTagPrefix}-${String(counter).padStart(4, "0")}`;
  }

  private async selectUnits(
    tx: Tx,
    deviceId: string,
    status: DeviceUnitStatus,
    quantity: number
  ) {
    return tx.deviceUnit.findMany({
      where: { deviceId, status },
      orderBy: { assetTag: "asc" },
      take: quantity,
      select: UNIT_SELECT,
    });
  }

  private async assertDevice(tx: Tx, deviceId: string) {
    const d = await tx.device.findUnique({ where: { id: deviceId } });
    if (!d) throw new HttpError(404, "DEVICE_NOT_FOUND_BY_ID", { deviceId });
    return d;
  }

  // Resuelve las unidades objetivo de un detalle: si trae `unitIds`, esas
  // unidades exactas; si trae `unitId`, esa pieza (1 a 1); si no, las primeras
  // `cantidad` unidades en el estado esperado.
  private async resolveTargetUnits(
    tx: Tx,
    item: MovementItemInput,
    sourceStatus: DeviceUnitStatus,
    missingCode: ErrorCode
  ) {
    if (item.unitIds) {
      return this.requireUnits(tx, item.deviceId, item.unitIds, sourceStatus);
    }
    if (item.unitId) {
      if (item.quantity && item.quantity > 1) {
        throw new HttpError(400, "SINGLE_UNIT_SELECTION");
      }
      const unit = await tx.deviceUnit.findUnique({ where: { id: item.unitId } });
      if (!unit) throw new HttpError(404, "DEVICE_UNIT_NOT_FOUND");
      if (unit.deviceId !== item.deviceId) {
        throw new HttpError(400, "UNIT_DEVICE_MISMATCH");
      }
      if (unit.status !== sourceStatus) {
        throw new HttpError(409, "UNIT_UNEXPECTED_STATUS", { assetTag: unit.assetTag, status: unit.status, expected: sourceStatus });
      }
      return [unit];
    }
    const units = await this.selectUnits(tx, item.deviceId, sourceStatus, item.quantity);
    if (units.length < item.quantity) {
      throw new HttpError(409, missingCode, { deviceId: item.deviceId, required: item.quantity, available: units.length });
    }
    return units;
  }

  // Payload de un detalle para `movement.create`, registrando siempre las
  // unidades exactas que mueve (las resueltas por quien llama, o la indicada
  // en `unitId`). Así la reversión nunca elige piezas al azar.
  private itemData(d: MovementItemInput, unitIds?: string[]) {
    const ids = unitIds ?? (d.unitId ? [d.unitId] : []);
    const base: Record<string, unknown> = {
      deviceId: d.deviceId,
      quantity: unitIds ? unitIds.length : d.unitId ? 1 : d.quantity,
      condition: (d.condition ?? null) as any,
      notes: (d.notes ?? null) as any,
    };
    if (ids.length > 0) base.units = { create: ids.map((deviceUnitId) => ({ deviceUnitId })) };
    return base;
  }

  // Baja automática de unidades en estado ROTO (devueltas o salidas de mantenimiento).
  private async createAutomaticRetirement(
    tx: Tx,
    authorId: string,
    units: { deviceUnitId: string; deviceId: string; notes: string | null }[],
    reasonExtra?: string
  ) {
    if (units.length === 0) return null;
    const reason = reasonExtra ?? t("inventory.autoRetireBroken", {}, await systemLanguage());
    const movement = await tx.movement.create({
      data: {
        type: "RETIREMENT",
        createdById: authorId,
        reason,
        notes: [...new Set(units.map((u) => u.notes).filter(Boolean))].join(" | ") || null,
        items: {
          create: units.map((u) =>
            this.itemData({
              deviceId: u.deviceId,
              quantity: 1,
              condition: "BROKEN",
              notes: u.notes ?? undefined,
              unitId: u.deviceUnitId,
            })
          ) as any,
        },
      },
      include: { items: true },
    });
    await this.audit(tx, "MOVEMENT_RETIREMENT", movement.id, authorId, { reason, units });
    this.broadcast("RETIREMENT", units.length, movement.id, movement.items[0]?.deviceId);
    return movement;
  }

  private async movementEntry(tx: Tx, input: CreateMovementInput, authorId: string) {
    if (input.items.length === 0) throw new HttpError(400, "ITEMS_REQUIRED");
    const createdItems: { deviceId: string; unitIds: string[] }[] = [];
    for (const item of input.items) {
      const d = await this.assertDevice(tx, item.deviceId);
      const typeId = d.typeId;
      const unitIds: string[] = [];
      for (let i = 0; i < item.quantity; i++) {
        const unit = await tx.deviceUnit.create({
          data: {
            deviceId: item.deviceId,
            assetTag: await this.nextActive(tx, typeId),
            status: "AVAILABLE",
          },
        });
        unitIds.push(unit.id);
      }
      createdItems.push({ deviceId: item.deviceId, unitIds });
    }
    const movement = await tx.movement.create({
      data: {
        type: input.type,
        createdById: authorId,
        reason: input.reason,
        notes: input.notes,
        items: {
          create: createdItems.map((d) => ({
            deviceId: d.deviceId,
            quantity: d.unitIds.length,
            units: { create: d.unitIds.map((deviceUnitId) => ({ deviceUnitId })) },
          })),
        },
      },
      include: { items: true },
    });
    await this.audit(tx, `MOVEMENT_${input.type}`, movement.id, authorId, input);
    this.broadcast(input.type, input.items.length, movement.id, movement.items[0]?.deviceId);
    return movement;
  }

  private async movementRetirement(tx: Tx, input: CreateMovementInput, authorId: string) {
    if (input.items.length === 0) throw new HttpError(400, "ITEMS_REQUIRED");
    // Las unidades salen de disponibles: la condición no aplica (en el kardex,
    // POOR marca la baja de una unidad DAÑADA, que no restaría disponibles).
    input = { ...input, items: input.items.map((item) => ({ ...item, condition: undefined })) };
    if (!input.reason) throw new HttpError(400, "RETIREMENT_REASON_REQUIRED");
    const resolvedItems: string[][] = [];
    for (const item of input.items) {
      await this.assertDevice(tx, item.deviceId);
      const available = await this.resolveTargetUnits(
        tx,
        item,
        "AVAILABLE",
        "NOT_ENOUGH_UNITS"
      );
      const ids = available.map((u) => u.id);
      await this.transitionUnits(tx, ids, "AVAILABLE", { status: "RETIRED" });
      resolvedItems.push(ids);
    }
    const movement = await tx.movement.create({
      data: {
        type: input.type,
        createdById: authorId,
        reason: input.reason,
        notes: input.notes,
        items: { create: input.items.map((d, i) => this.itemData(d, resolvedItems[i]) as any) },
      },
      include: { items: true },
    });
    await this.audit(tx, `MOVEMENT_${input.type}`, movement.id, authorId, input);
    this.broadcast(input.type, input.items.length, movement.id, movement.items[0]?.deviceId);
    return movement;
  }

  private async movementLoan(tx: Tx, input: CreateMovementInput, authorId: string) {
    if (!input.custodianId && !input.departmentId) {
      throw new HttpError(400, "CUSTODIAN_OR_DEPARTMENT_REQUIRED");
    }
    if (input.items.length === 0) throw new HttpError(400, "ITEMS_REQUIRED");

    const loan = await tx.loan.create({
      data: {
        custodianId: input.custodianId ?? null,
        departmentId: input.departmentId ?? null,
        subareaId: input.subareaId ?? null,
        notes: input.notes,
        number: await this.nextLoanNumber(tx),
      },
    });

    // Unidades exactas de cada renglón: la carta, el préstamo y el kardex
    // quedan ligados a las mismas piezas.
    const loaned: { deviceId: string; unitIds: string[] }[] = [];
    for (const item of input.items) {
      await this.assertDevice(tx, item.deviceId);
      const unitIds = (await this.unitsToLoan(tx, item)).map((u) => u.id);
      await tx.loanItem.create({
        data: {
          loanId: loan.id,
          deviceId: item.deviceId,
          quantity: unitIds.length,
          units: { create: unitIds.map((deviceUnitId) => ({ deviceUnitId })) },
        },
      });
      await this.transitionUnits(tx, unitIds, "AVAILABLE", {
        status: "ON_LOAN",
        departmentId: input.departmentId ?? null,
      });
      loaned.push({ deviceId: item.deviceId, unitIds });
    }

    const movement = await tx.movement.create({
      data: {
        type: "LOAN",
        createdById: authorId,
        custodianId: input.custodianId ?? null,
        departmentId: input.departmentId ?? null,
        reason: input.reason,
        notes: input.notes,
        loan: { connect: { id: loan.id } },
        items: {
          create: loaned.map((d) => ({
            deviceId: d.deviceId,
            quantity: d.unitIds.length,
            units: { create: d.unitIds.map((deviceUnitId) => ({ deviceUnitId })) },
          })),
        },
      },
      include: { items: true },
    });
    await tx.loan.update({ where: { id: loan.id }, data: { movementId: movement.id } });
    await this.audit(tx, "MOVEMENT_LOAN", movement.id, authorId, input);
    this.broadcast("LOAN", input.items.length, movement.id, movement.items[0]?.deviceId);
    return movement;
  }

  private async movementLoanReturn(tx: Tx, input: CreateMovementInput, authorId: string) {
    if (!input.loanId) throw new HttpError(400, "LOAN_REQUIRED");
    const loan = await tx.loan.findUnique({
      where: { id: input.loanId },
      include: { items: true },
    });
    if (!loan) throw new HttpError(404, "LOAN_NOT_FOUND");
    if (loan.status === "RETURNED" || loan.status === "CANCELLED") {
      throw new HttpError(409, "LOAN_CLOSED");
    }

    const effectiveItems: MovementItemInput[] = [];
    const unitsRetirement: { deviceUnitId: string; deviceId: string; notes: string | null }[] = [];
    // Una devolución puede traer varias líneas del mismo detalle de préstamo
    // (§14: unas piezas vuelven bien y otras dañadas). `prestamo.detalles` es
    // una foto previa al ciclo, así que lo devuelto se acumula aquí en vez de
    // releer `pd.devuelto` en cada vuelta — si no, la última línea pisaría a
    // las anteriores y el préstamo nunca cerraría.
    const returnedByItem = new Map<string, number>();
    for (const item of input.items) {
      if (!item.loanItemId) throw new HttpError(400, "LOAN_ITEM_ID_REQUIRED");
      const pd = loan.items.find((x) => x.id === item.loanItemId);
      if (!pd) throw new HttpError(404, "LOAN_ITEM_NOT_FOUND");
      const alreadyReturned = returnedByItem.get(pd.id) ?? pd.returnedQuantity;
      const pending = pd.quantity - alreadyReturned;
      if (item.quantity > pending) {
        throw new HttpError(409, "RETURN_EXCEEDS_PENDING", { pending });
      }

      // Las unidades que regresan: las indicadas (deben estar pendientes en
      // este renglón) o, si solo viene cantidad, las primeras pendientes.
      let loanedUnits;
      if (item.unitIds) {
        loanedUnits = await tx.loanItemUnit.findMany({
          where: { loanItemId: pd.id, returned: false, deviceUnitId: { in: item.unitIds } },
          include: { deviceUnit: true },
        });
        if (loanedUnits.length !== item.unitIds.length) {
          const pendingIds = new Set(loanedUnits.map((pu) => pu.deviceUnitId));
          const missing = item.unitIds.find((id) => !pendingIds.has(id))!;
          const unit = await tx.deviceUnit.findUnique({ where: { id: missing }, select: { assetTag: true } });
          throw new HttpError(409, "UNIT_NOT_PENDING_IN_LOAN", { assetTag: unit?.assetTag ?? missing });
        }
      } else {
        loanedUnits = await tx.loanItemUnit.findMany({
          where: { loanItemId: pd.id, returned: false },
          orderBy: { deviceUnit: { assetTag: "asc" } },
          take: item.quantity,
          include: { deviceUnit: true },
        });
        if (loanedUnits.length < item.quantity) {
          throw new HttpError(409, "NOT_ENOUGH_PENDING_UNITS");
        }
      }

      const newStatus = conditionToStatus(item.condition as Condition);
      const unitIds = loanedUnits.map((pu) => pu.deviceUnitId);
      await this.transitionUnits(tx, unitIds, "ON_LOAN", { status: newStatus });
      const closed = await tx.loanItemUnit.updateMany({
        where: { id: { in: loanedUnits.map((pu) => pu.id) }, returned: false },
        data: { returned: true },
      });
      if (closed.count !== loanedUnits.length) throw new HttpError(409, "UNITS_CHANGED");
      if (newStatus === "RETIRED") {
        for (const pu of loanedUnits) {
          unitsRetirement.push({ deviceUnitId: pu.deviceUnitId, deviceId: pu.deviceUnit.deviceId, notes: item.notes ?? null });
        }
      }
      const totalReturned = alreadyReturned + item.quantity;
      returnedByItem.set(pd.id, totalReturned);
      await tx.loanItem.update({
        where: { id: pd.id },
        data: { returnedQuantity: totalReturned },
      });

      effectiveItems.push({
        deviceId: pd.deviceId,
        loanItemId: pd.id,
        quantity: unitIds.length,
        unitIds,
        condition: item.condition as any,
        notes: item.notes,
      });
    }

    // Recalcular estado del préstamo.
    const updatedItems = await tx.loanItem.findMany({ where: { loanId: loan.id } });
    const fullyReturned = updatedItems.every((d) => d.returnedQuantity >= d.quantity);
    const partial = updatedItems.some((d) => d.returnedQuantity > 0);
    await tx.loan.update({
      where: { id: loan.id },
      data: { status: fullyReturned ? "RETURNED" : partial ? "PARTIAL" : "ACTIVE" },
    });

    const movement = await tx.movement.create({
      data: {
        type: "RETURN",
        createdById: authorId,
        custodianId: input.custodianId ?? loan.custodianId,
        reason: input.reason,
        notes: input.notes,
        items: {
          create: effectiveItems.map((d) => ({
            deviceId: d.deviceId,
            quantity: d.quantity,
            condition: (d.condition ?? null) as any,
            notes: (d.notes ?? null) as any,
            units: { create: d.unitIds!.map((deviceUnitId) => ({ deviceUnitId })) },
          })),
        },
      },
      include: { items: true },
    });

    const loanReturn = await tx.loanReturn.create({
      data: {
        loanId: loan.id,
        movementId: movement.id,
        custodianId: input.custodianId ?? loan.custodianId,
        number: await this.nextLoanReturnNumber(tx),
        notes: input.notes,
      },
    });
    for (const item of effectiveItems) {
      await tx.loanReturnItem.create({
        data: {
          loanReturnId: loanReturn.id,
          loanItemId: item.loanItemId!,
          deviceId: item.deviceId,
          quantity: item.quantity,
          condition: item.condition as any,
          notes: (item.notes ?? null) as any,
          units: { create: item.unitIds!.map((deviceUnitId) => ({ deviceUnitId })) },
        },
      });
    }

    await this.audit(tx, "MOVEMENT_RETURN", movement.id, authorId, input);
    await this.createAutomaticRetirement(tx, authorId, unitsRetirement);
    this.broadcast("RETURN", effectiveItems.length, movement.id, movement.items[0]?.deviceId);
    return movement;
  }

  private async movementTransfer(tx: Tx, input: CreateMovementInput, authorId: string) {
    if (!input.departmentId) throw new HttpError(400, "DEPARTMENT_REQUIRED");
    if (input.items.length === 0) throw new HttpError(400, "ITEMS_REQUIRED");
    const resolvedItems: string[][] = [];
    for (const item of input.items) {
      await this.assertDevice(tx, item.deviceId);
      // Con candado optimista: si una unidad se prestó entre la lectura y la
      // escritura, la transacción aborta en vez de traspasar una pieza ajena.
      const available = await this.resolveTargetUnits(tx, item, "AVAILABLE", "NOT_ENOUGH_UNITS_FOR_DEVICE");
      const ids = available.map((u) => u.id);
      await this.transitionUnits(tx, ids, "AVAILABLE", { departmentId: input.departmentId });
      resolvedItems.push(ids);
    }
    const movement = await tx.movement.create({
      data: {
        type: "TRANSFER",
        createdById: authorId,
        departmentId: input.departmentId,
        reason: input.reason,
        notes: input.notes,
        items: { create: input.items.map((d, i) => this.itemData(d, resolvedItems[i]) as any) },
      },
      include: { items: true },
    });
    await this.audit(tx, "MOVEMENT_TRANSFER", movement.id, authorId, input);
    return movement;
  }

  private async movementMaintenanceIn(tx: Tx, input: CreateMovementInput, authorId: string) {
    const resolvedItems: string[][] = [];
    for (const item of input.items) {
      await this.assertDevice(tx, item.deviceId);
      const available = await this.resolveTargetUnits(
        tx,
        item,
        "AVAILABLE",
        "NOT_ENOUGH_UNITS"
      );
      const ids = available.map((u) => u.id);
      await this.transitionUnits(tx, ids, "AVAILABLE", { status: "IN_MAINTENANCE" });
      resolvedItems.push(ids);
    }
    const movement = await tx.movement.create({
      data: {
        type: "MAINTENANCE_IN",
        createdById: authorId,
        reason: input.reason,
        notes: input.notes,
        items: { create: input.items.map((d, i) => this.itemData(d, resolvedItems[i]) as any) },
      },
      include: { items: true },
    });
    await this.audit(tx, "MOVEMENT_MAINTENANCE_IN", movement.id, authorId, input);
    return movement;
  }

  private async movementMaintenanceOut(tx: Tx, input: CreateMovementInput, authorId: string) {
    const unitsRetirement: { deviceUnitId: string; deviceId: string; notes: string | null }[] = [];
    const resolvedItems: string[][] = [];
    for (const item of input.items) {
      await this.assertDevice(tx, item.deviceId);
      const inMaintenance = await this.resolveTargetUnits(
        tx,
        item,
        "IN_MAINTENANCE",
        "NOT_ENOUGH_UNITS_IN_MAINTENANCE"
      );
      const newStatus = conditionToStatus(item.condition as Condition | null);
      const ids = inMaintenance.map((u) => u.id);
      await this.transitionUnits(tx, ids, "IN_MAINTENANCE", { status: newStatus });
      for (const u of inMaintenance) {
        if (newStatus === "RETIRED") {
          unitsRetirement.push({ deviceUnitId: u.id, deviceId: u.deviceId, notes: item.notes ?? null });
        }
      }
      resolvedItems.push(ids);
    }
    const movement = await tx.movement.create({
      data: {
        type: "MAINTENANCE_OUT",
        createdById: authorId,
        reason: input.reason,
        notes: input.notes,
        items: { create: input.items.map((d, i) => this.itemData(d, resolvedItems[i]) as any) },
      },
      include: { items: true },
    });
    await this.audit(tx, "MOVEMENT_MAINTENANCE_OUT", movement.id, authorId, input);
    await this.createAutomaticRetirement(tx, authorId, unitsRetirement);
    return movement;
  }

  private async movementReversion(tx: Tx, input: CreateMovementInput, authorId: string) {
    if (!input.movementId) throw new HttpError(400, "MOVEMENT_ID_REQUIRED");
    const source = await tx.movement.findUnique({
      where: { id: input.movementId },
      include: { items: { include: { units: true } }, loan: { include: { items: true } } },
    });
    if (!source) throw new HttpError(404, "SOURCE_MOVEMENT_NOT_FOUND");
    if (source.status === "CANCELLED") throw new HttpError(409, "MOVEMENT_ALREADY_REVERSED");

    // Unidades exactas registradas en el movimiento origen (si las tiene).
    const resolver = (item: { id: string; deviceId: string; quantity: number; units: { deviceUnitId: string }[] }, sourceStatus: DeviceUnitStatus) => {
      if (item.units.length > 0) {
        return item.units.map((u) => u.deviceUnitId);
      }
      return this.selectUnits(tx, item.deviceId, sourceStatus, item.quantity).then((units) =>
        units.map((u) => u.id)
      );
    };

    // Candado: las unidades deben seguir en el estado que les dejó el
    // movimiento origen (una que ya se prestó no se regresa a mantenimiento).
    switch (source.type) {
      case "MAINTENANCE_IN": {
        for (const item of source.items) {
          const ids = await resolver(item, "IN_MAINTENANCE");
          await this.transitionUnits(tx, ids, "IN_MAINTENANCE", { status: "AVAILABLE" });
        }
        break;
      }
      case "MAINTENANCE_OUT": {
        for (const item of source.items) {
          if (item.condition === "BROKEN") continue;
          const leftAs = conditionToStatus(item.condition as Condition | null);
          const ids = await resolver(item, leftAs);
          await this.transitionUnits(tx, ids, leftAs, { status: "IN_MAINTENANCE" });
        }
        break;
      }
      default:
        throw new HttpError(409, "MOVEMENT_NOT_REVERSIBLE");
    }

    await tx.movement.update({ where: { id: source.id }, data: { status: "CANCELLED" } });
    const lng = await systemLanguage();
    const reversion = await tx.movement.create({
      data: {
        type: "REVERSAL",
        createdById: authorId,
        reason: t("inventory.reversalOf", { type: label("movementType", source.type, lng) }, lng),
        notes: input.notes,
        // FK escalar, no `reversaDe: { connect }`: al fijar `usuarioId` el input
        // ya es el variante "unchecked" de Prisma, que no acepta relaciones.
        reversalOfId: source.id,
        items: {
          create: source.items
            .filter((d) => d.condition !== "BROKEN")
            .map((d) => ({
              deviceId: d.deviceId,
              quantity: d.quantity,
              condition: (d.condition ?? null) as any,
              notes: (d.notes ?? null) as any,
              ...(d.units.length > 0 ? { units: { create: d.units.map((u) => ({ deviceUnitId: u.deviceUnitId })) } } : {}),
            })),
        },
      } satisfies Prisma.MovementUncheckedCreateInput,
      include: { items: true },
    });
    await this.audit(tx, "MOVEMENT_REVERSAL", reversion.id, authorId, input);
    return reversion;
  }

  listMovements(filters: { type?: string; deviceId?: string } = {}) {
    const where: Prisma.MovementWhereInput = {};
    if (filters.type) where.type = filters.type as MovementType;
    if (filters.deviceId) where.items = { some: { deviceId: filters.deviceId } };
    return this.db.movement.findMany({
      where,
      orderBy: { date: "desc" },
      include: {
        items: {
          include: {
            device: { include: { type: true } },
            units: { include: { deviceUnit: true } },
          },
        },
        createdBy: { select: { id: true, name: true } },
        custodian: { select: { id: true, name: true } },
        loan: true,
      },
    });
  }

  getMovement(id: string) {
    return this.db.movement.findUnique({
      where: { id },
      include: {
        items: {
          include: {
            device: { include: { type: true } },
            units: { include: { deviceUnit: true } },
          },
        },
        createdBy: { select: { id: true, name: true } },
        custodian: { select: { id: true, name: true } },
        reversalOf: true,
        loan: { include: { items: true } },
      },
    });
  }

  // ---------------------------------------------------------------------------
  // Préstamos y devoluciones
  // ---------------------------------------------------------------------------
  listLoans(filters: { status?: string; custodianId?: string } = {}) {
    const where: Prisma.LoanWhereInput = {};
    if (filters.status) where.status = filters.status as any;
    if (filters.custodianId) where.custodianId = filters.custodianId;
    return this.db.loan.findMany({
      where,
      orderBy: { date: "desc" },
      include: {
        custodian: { select: { id: true, name: true, username: true, employeeNumber: true, department: { select: { id: true, name: true } } } },
        department: { select: { id: true, name: true } },
        subarea: { select: { id: true, name: true } },
        items: {
          include: { device: { include: { type: true } } },
        },
        returns: { select: { id: true, number: true, date: true } },
      },
    });
  }

  getLoan(id: string) {
    return this.db.loan.findUnique({
      where: { id },
      include: {
        custodian: { select: { id: true, name: true, username: true, employeeNumber: true, department: { select: { id: true, name: true } } } },
        department: { select: { id: true, name: true } },
        subarea: { select: { id: true, name: true } },
        items: {
          include: {
            device: { include: { type: true } },
            units: { include: { deviceUnit: true } },
          },
        },

        returns: {
          include: {
            custodian: { select: { id: true, name: true } },
            items: {
              include: {
                device: { select: { id: true, name: true } },
                units: { include: { deviceUnit: true } },
              },
            },
          },
        },
      },
    });
  }

  async updateLoan(id: string, input: UpdateLoanInput) {
    return this.serializable(async (tx) => {
        const loan = await tx.loan.findUnique({
          where: { id },
          include: {
            items: { include: { units: { include: { deviceUnit: true } } } },
            movement: true,
          },
        });
        if (!loan) throw new HttpError(404, "LOAN_NOT_FOUND");
        if (loan.status === "RETURNED" || loan.status === "CANCELLED") {
          throw new HttpError(409, "LOAN_CLOSED");
        }

        const resourceChange =
          input.deviceId !== undefined || input.quantity !== undefined || input.unitIds !== undefined;
        const hasReturns = loan.items.some((d) => d.returnedQuantity > 0);
        if (resourceChange && hasReturns) {
          throw new HttpError(409, "LOAN_HAS_RETURNS");
        }

        // Asignación / observaciones
        const data: Record<string, unknown> = {};
        if (input.custodianId !== undefined) data.custodianId = input.custodianId || null;
        if (input.departmentId !== undefined) data.departmentId = input.departmentId || null;
        if (input.subareaId !== undefined) data.subareaId = input.subareaId || null;
        if (input.notes !== undefined) data.notes = input.notes || null;
        if (Object.keys(data).length > 0) {
          await tx.loan.update({ where: { id }, data });
        }

        // Recurso (solo si no hay devoluciones)
        let newUnitIds: string[] = [];
        if (resourceChange && !hasReturns) {
          const item = loan.items[0];
          if (!item) throw new HttpError(400, "LOAN_HAS_NO_ITEMS");
          const deviceId = input.deviceId ?? item.deviceId;
          const quantity = input.unitIds?.length ?? input.quantity ?? item.quantity;
          const newDevice = await tx.device.findUnique({ where: { id: deviceId } });
          if (!newDevice) throw new HttpError(404, "DEVICE_NOT_FOUND");

          // Liberar las unidades que el préstamo tiene prestadas (siguen
          // ON_LOAN o la operación aborta).
          const open = item.units.filter((pu) => !pu.returned);
          await this.transitionUnits(tx, open.map((pu) => pu.deviceUnitId), "ON_LOAN", { status: "AVAILABLE" });
          await tx.loanItemUnit.deleteMany({ where: { id: { in: open.map((pu) => pu.id) } } });

          // Asignar las nuevas: las indicadas (pueden repetir las liberadas)
          // o, si solo cambió la cantidad, las primeras disponibles.
          const available = await tx.deviceUnit.count({ where: { deviceId, status: "AVAILABLE" } });
          if (!input.unitIds && available < quantity) {
            throw new HttpError(409, "NOT_ENOUGH_UNITS_COUNT", { required: quantity, available });
          }
          newUnitIds = (await this.unitsToLoan(tx, { deviceId, quantity, unitIds: input.unitIds })).map((u) => u.id);
          await tx.loanItem.update({
            where: { id: item.id },
            data: {
              deviceId,
              quantity: newUnitIds.length,
              units: { create: newUnitIds.map((deviceUnitId) => ({ deviceUnitId })) },
            },
          });
          await this.transitionUnits(tx, newUnitIds, "AVAILABLE", {
            status: "ON_LOAN",
            departmentId: (input.departmentId ?? loan.departmentId) || null,
          });
        }

        // Mantener el movimiento PRESTAMO consistente (cabecera + detalle).
        if (loan.movement) {
          const movementData: Record<string, unknown> = {};
          if (input.custodianId !== undefined) movementData.custodianId = input.custodianId || null;
          if (input.departmentId !== undefined) movementData.departmentId = input.departmentId || null;
          if (input.notes !== undefined) movementData.notes = input.notes || null;
          if (Object.keys(movementData).length > 0) {
            await tx.movement.update({ where: { id: loan.movement.id }, data: movementData });
          }
          if (resourceChange && !hasReturns) {
            const md = await tx.movementItem.findFirst({
              where: { movementId: loan.movement.id },
            });
            if (md) {
              const item = loan.items[0];
              const deviceId = input.deviceId ?? item?.deviceId ?? md.deviceId;
              await tx.movementItem.update({
                where: { id: md.id },
                data: {
                  deviceId,
                  quantity: newUnitIds.length,
                  units: { deleteMany: {}, create: newUnitIds.map((deviceUnitId) => ({ deviceUnitId })) },
                },
              });
            }
          }
        }

        // Dentro de `tx`: leer por `this.db` usa otra conexión y, con aislamiento
        // Serializable, devolvería el préstamo previo a esta misma edición.
        return tx.loan.findUnique({
          where: { id },
          include: {
            custodian: { select: { id: true, name: true, username: true, employeeNumber: true, department: { select: { id: true, name: true } } } },
            department: { select: { id: true, name: true } },
            subarea: { select: { id: true, name: true } },
            items: {
              include: {
                device: { include: { type: true } },
                units: { include: { deviceUnit: true } },
              },
            },
returns: {
          include: {
            custodian: { select: { id: true, name: true } },
            items: {
              include: {
                device: { select: { id: true, name: true } },
                units: { include: { deviceUnit: true } },
              },
            },
          },
        },
          },
        });
    });
  }

  /**
   * Cancela un préstamo: sus unidades pendientes regresan a disponibles y se
   * registra una REVERSIÓN del movimiento LOAN con esas unidades exactas, así
   * el kardex regresa lo que el préstamo sacó (lo ya devuelto entró con su
   * propia devolución). El LOAN queda CANCELLED.
   */
  async cancelLoan(id: string, authorId?: string) {
    if (!authorId) throw new HttpError(400, "USER_ID_REQUIRED");
    // El estado se valida DENTRO de la transacción: validarlo antes dejaba que
    // una devolución o una segunda cancelación se colaran entre la lectura y
    // la escritura.
    return this.serializable(async (tx) => {
      const loan = await tx.loan.findUnique({ where: { id } });
      if (!loan) throw new HttpError(404, "LOAN_NOT_FOUND");
      if (loan.status === "RETURNED" || loan.status === "CANCELLED") {
        throw new HttpError(409, "LOAN_CLOSED");
      }
      const items = await tx.loanItem.findMany({ where: { loanId: id } });
      const released: { deviceId: string; unitIds: string[] }[] = [];
      for (const pd of items) {
        const pending = await tx.loanItemUnit.findMany({
          where: { loanItemId: pd.id, returned: false },
        });
        const unitIds = pending.map((u) => u.deviceUnitId);
        await this.transitionUnits(tx, unitIds, "ON_LOAN", { status: "AVAILABLE" });
        const closed = await tx.loanItemUnit.updateMany({
          where: { id: { in: pending.map((u) => u.id) }, returned: false },
          data: { returned: true },
        });
        if (closed.count !== pending.length) throw new HttpError(409, "UNITS_CHANGED");
        await tx.loanItem.update({ where: { id: pd.id }, data: { returnedQuantity: pd.quantity } });
        if (unitIds.length > 0) released.push({ deviceId: pd.deviceId, unitIds });
      }

      if (loan.movementId) {
        await tx.movement.update({ where: { id: loan.movementId }, data: { status: "CANCELLED" } });
        if (released.length > 0) {
          const lng = await systemLanguage();
          const reversal = await tx.movement.create({
            data: {
              type: "REVERSAL",
              createdById: authorId,
              custodianId: loan.custodianId,
              departmentId: loan.departmentId,
              reason: t("inventory.loanCancelled", { number: loan.number }, lng),
              reversalOfId: loan.movementId,
              items: {
                create: released.map((r) => ({
                  deviceId: r.deviceId,
                  quantity: r.unitIds.length,
                  units: { create: r.unitIds.map((deviceUnitId) => ({ deviceUnitId })) },
                })),
              },
            } satisfies Prisma.MovementUncheckedCreateInput,
          });
          this.broadcast("REVERSAL", released.length, reversal.id, released[0]?.deviceId);
        }
      }
      await this.audit(tx, "LOAN_CANCELLED", id, authorId, { reason: loan.number, items: released }, "Loan");
      return tx.loan.update({ where: { id }, data: { status: "CANCELLED" } });
    });
  }

  listReturns(filters: { loanId?: string } = {}) {
    const where: Prisma.LoanReturnWhereInput = {};
    if (filters.loanId) where.loanId = filters.loanId;
    return this.db.loanReturn.findMany({
      where,
      orderBy: { date: "desc" },
      include: {
        loan: {
          select: {
            id: true,
            number: true,
            custodian: { select: { name: true } },
            department: { select: { name: true } },
          },
        },
        items: { include: { device: true } },
      },
    });
  }

  // ---------------------------------------------------------------------------
  // Dashboard
  // ---------------------------------------------------------------------------
  async dashboard() {
    const [types, devices, units] = await Promise.all([
      this.db.deviceType.count(),
      this.db.device.count(),
      this.db.deviceUnit.findMany({ select: { status: true } }),
    ]);

    const map: Record<DeviceUnitStatus, number> = {
      AVAILABLE: 0,
      ON_LOAN: 0,
      DAMAGED: 0,
      IN_MAINTENANCE: 0,
      RETIRED: 0,
    };
    for (const u of units) map[u.status] += 1;
    const active = map.AVAILABLE + map.ON_LOAN + map.DAMAGED + map.IN_MAINTENANCE;

    const byType = await this.db.deviceType.findMany({
      orderBy: { name: "asc" },
      include: {
        devices: {
          include: {
            units: { select: { status: true } },
          },
        },
      },
    });

    return {
      stats: {
        types,
        devices,
        activeUnits: active,
        available: map.AVAILABLE,
        loaned: map.ON_LOAN,
        damaged: map.DAMAGED,
        maintenance: map.IN_MAINTENANCE,
        retirement: map.RETIRED,
      },
      byType: byType.map((t) => ({
        id: t.id,
        code: t.code,
        name: t.name,
        devices: t.devices.map((d) => {
          const statuses: Record<DeviceUnitStatus, number> = {
            AVAILABLE: 0,
            ON_LOAN: 0,
            DAMAGED: 0,
            IN_MAINTENANCE: 0,
            RETIRED: 0,
          };
          for (const u of d.units) statuses[u.status] += 1;
          return {
            id: d.id,
            name: d.name,
            brand: d.brand,
            model: d.model,
            available: statuses.AVAILABLE,
            loaned: statuses.ON_LOAN,
            damaged: statuses.DAMAGED,
            maintenance: statuses.IN_MAINTENANCE,
            retirement: statuses.RETIRED,
            total: d.units.length,
          };
        }),
      })),
    };
  }

  // ---------------------------------------------------------------------------
  // Helpers privados
  // ---------------------------------------------------------------------------
  /**
   * Siguiente folio de una serie `PREFIJO-0001`.
   *
   * Se calcula desde el folio más alto de la serie, no desde un `count()`:
   * el conteo sólo acierta si la serie es densa y arranca en 1, y aquí no lo
   * es — las cartas migradas del sistema viejo conservan su consecutivo por
   * tipo (`LPT-0001`, `CTM-0001`…), así que cuentan sin pertenecer a la serie,
   * y cualquier borrado abre un hueco. En ambos casos `count() + 1` cae sobre
   * un folio ya usado y el `@unique` responde 409.
   */
  private async nextNumber(prefix: string, last: string | undefined) {
    const actual = Number(last?.slice(prefix.length)) || 0;
    return `${prefix}${String(actual + 1).padStart(4, "0")}`;
  }

  private async nextLoanNumber(tx: Tx) {
    const last = await tx.loan.findFirst({
      where: { number: { startsWith: "CARTA-" } },
      orderBy: { number: "desc" },
      select: { number: true },
    });
    return this.nextNumber("CARTA-", last?.number);
  }

  private async nextLoanReturnNumber(tx: Tx) {
    const last = await tx.loanReturn.findFirst({
      where: { number: { startsWith: "DEV-" } },
      orderBy: { number: "desc" },
      select: { number: true },
    });
    return this.nextNumber("DEV-", last?.number);
  }

  private async audit(
    tx: Tx,
    action: string,
    entityId: string,
    userId: string,
    input: unknown,
    entityType = "Movement"
  ) {
    const data = input as Record<string, unknown>;
    await this.auditPort.createLog(
      {
        action,
        entityType,
        entityId,
        userId,
        newState: {
          type: data.type,
          items: data.items,
          reason: data.reason,
          notes: data.notes,
        },
      },
      tx as any
    );
  }

  private broadcast(type: MovementType, count: number, targetId?: string, deviceId?: string | null) {
    broadcastDashboardEvent({
      scope: "inventory",
      message: (lng) => t("activity.movementsRegistered", { type: label("movementType", type, lng), count }, lng),
      targetId,
      deviceId: deviceId ?? undefined,
    }).catch(() => {});
  }
}