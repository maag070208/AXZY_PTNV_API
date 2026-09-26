import { Prisma } from "@prisma/client";
import { prismaClient } from "@core/config/database";
import { HttpError } from "@core/middlewares/error.middleware";
import type { ErrorCode } from "@core/i18n";
import { broadcastDashboardEvent } from "@core/services/ably";
import { ci } from "@core/utils/table";
import type { AuditPort } from "../../audit/models/entity/audit.entity";
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
    return this.db.$transaction(
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
          input.units && input.units.length > 0
            ? input.units
            : Array.from({ length: input.initialQuantity ?? 0 }, () => ({} as { serialNumber?: string; macAddress?: string; ip?: string; hostname?: string }));

        const units = [];
        let counter = type.counter;
        for (let i = 0; i < unitsData.length; i++) {
          counter += 1;
          const assetTag = `${type.assetTagPrefix}-${String(counter).padStart(4, "0")}`;
          units.push(
            tx.deviceUnit.create({
              data: {
                deviceId: device.id,
                assetTag,
                status: "AVAILABLE",
                serialNumber: unitsData[i].serialNumber || null,
                macAddress: unitsData[i].macAddress || null,
                ip: unitsData[i].ip || null,
                hostname: unitsData[i].hostname || null,
              },
            })
          );
        }
        await Promise.all(units);
        await tx.deviceType.update({
          where: { id: type.id },
          data: { counter },
        });

        await tx.movement.create({
          data: {
            type: "STOCK_IN",
            createdById: authorId,
            reason: "Alta inicial",
            items: {
              create: [{ deviceId: device.id, quantity: unitsData.length }],
            },
          },
        });

        return device;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    );
  }

  async updateDevice(id: string, input: UpdateDeviceInput) {
    const existing = await this.db.device.findUnique({ where: { id } });
    if (!existing) throw new HttpError(404, "DEVICE_NOT_FOUND");
    return this.db.device.update({ where: { id }, data: input });
  }

  async updateUnit(id: string, input: UpdateUnitInput) {
    const existing = await this.db.deviceUnit.findUnique({ where: { id } });
    if (!existing) throw new HttpError(404, "UNIT_NOT_FOUND");
    return this.db.deviceUnit.update({ where: { id }, data: input });
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
      orderBy: { movement: { date: "asc" } },
      include: { movement: { include: { createdBy: { select: { id: true, name: true } } } } },
    });

    let balance = 0;
    const rows = items.map((d) => {
      const isEntry = ["STOCK_IN", "RETURN", "ADJUSTMENT_IN", "MAINTENANCE_OUT", "REVERSAL"].includes(
        d.movement.type
      );
      const delta = isEntry ? d.quantity : -d.quantity;
      balance += delta;
      return {
        date: d.movement.date,
        type: d.movement.type,
        stockIn: isEntry ? d.quantity : 0,
        stockOut: isEntry ? 0 : d.quantity,
        balance,
        condition: (d.condition ?? null) as any,
        reason: d.movement.reason,
        notes: d.movement.notes,
        user: d.movement.createdBy?.name ?? null,
      };
    });

    return { device, stock: await this.stock(deviceId), rows };
  }

  // ---------------------------------------------------------------------------
  // Movimientos
  // ---------------------------------------------------------------------------
  async registerMovement(input: CreateMovementInput, authorId?: string) {
    if (!authorId) throw new HttpError(400, "USER_ID_REQUIRED");
    return this.db.$transaction(
      async (tx) => {
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
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    );
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

  // Resuelve las unidades objetivo de un detalle: si trae `unidadId`, usa esa
  // unidad física exacta (1 a 1); si no, elige las primeras `cantidad` unidades.
  private async resolveTargetUnits(
    tx: Tx,
    item: MovementItemInput,
    sourceStatus: DeviceUnitStatus,
    missingCode: ErrorCode
  ) {
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

  // Payload de un detalle para `movimiento.create`, incluyendo la unidad exacta si aplica.
  private itemData(d: MovementItemInput) {
    const base: Record<string, unknown> = {
      deviceId: d.deviceId,
      quantity: d.unitId ? 1 : d.quantity,
      condition: (d.condition ?? null) as any,
      notes: (d.notes ?? null) as any,
    };
    if (d.unitId) (base.units as any) = { create: [{ deviceUnitId: d.unitId }] };
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
    const reason = reasonExtra ?? "Baja automática por estado ROTO";
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
    for (const item of input.items) {
      const d = await this.assertDevice(tx, item.deviceId);
      const typeId = d.typeId;
      const units = [];
      for (let i = 0; i < item.quantity; i++) {
        units.push(
          tx.deviceUnit.create({
            data: {
              deviceId: item.deviceId,
              assetTag: await this.nextActive(tx, typeId),
              status: "AVAILABLE",
            },
          })
        );
      }
      await Promise.all(units);
    }
    const movement = await tx.movement.create({
      data: {
        type: input.type,
        createdById: authorId,
        reason: input.reason,
        notes: input.notes,
        items: { create: input.items.map((d) => ({ deviceId: d.deviceId, quantity: d.quantity })) },
      },
      include: { items: true },
    });
    await this.audit(tx, `MOVEMENT_${input.type}`, movement.id, authorId, input);
    this.broadcast(input.type, input.items.length, movement.id, movement.items[0]?.deviceId);
    return movement;
  }

  private async movementRetirement(tx: Tx, input: CreateMovementInput, authorId: string) {
    if (input.items.length === 0) throw new HttpError(400, "ITEMS_REQUIRED");
    if (!input.reason) throw new HttpError(400, "RETIREMENT_REASON_REQUIRED");
    for (const item of input.items) {
      await this.assertDevice(tx, item.deviceId);
      const available = await this.resolveTargetUnits(
        tx,
        item,
        "AVAILABLE",
        "NOT_ENOUGH_UNITS"
      );
      await tx.deviceUnit.updateMany({
        where: { id: { in: available.map((u) => u.id) } },
        data: { status: "RETIRED" },
      });
    }
    const movement = await tx.movement.create({
      data: {
        type: input.type,
        createdById: authorId,
        reason: input.reason,
        notes: input.notes,
        items: { create: input.items.map((d) => this.itemData(d) as any) },
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

    for (const item of input.items) {
      await this.assertDevice(tx, item.deviceId);
      const available = await this.selectUnits(tx, item.deviceId, "AVAILABLE", item.quantity);
      if (available.length < item.quantity) {
        throw new HttpError(409, "NOT_ENOUGH_UNITS", { deviceId: item.deviceId, required: item.quantity, available: available.length });
      }
      const pd = await tx.loanItem.create({
        data: {
          loanId: loan.id,
          deviceId: item.deviceId,
          quantity: item.quantity,
        },
      });
      for (const u of available) {
        await tx.loanItemUnit.create({
          data: { loanItemId: pd.id, deviceUnitId: u.id },
        });
        await tx.deviceUnit.update({
          where: { id: u.id },
          data: { status: "ON_LOAN", departmentId: input.departmentId ?? null },
        });
      }
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
        items: { create: input.items.map((d) => ({ deviceId: d.deviceId, quantity: d.quantity })) },
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

      const loanedUnits = await tx.loanItemUnit.findMany({
        where: { loanItemId: pd.id, returned: false },
        orderBy: { deviceUnit: { assetTag: "asc" } },
        take: item.quantity,
        include: { deviceUnit: true },
      });
      if (loanedUnits.length < item.quantity) {
        throw new HttpError(409, "NOT_ENOUGH_PENDING_UNITS");
      }

      const newStatus = conditionToStatus(item.condition as Condition);
      for (const pu of loanedUnits) {
        await tx.deviceUnit.update({
          where: { id: pu.deviceUnitId },
          data: { status: newStatus },
        });
        if (newStatus === "RETIRED") {
          unitsRetirement.push({
            deviceUnitId: pu.deviceUnitId,
            deviceId: pu.deviceUnit.deviceId,
            notes: item.notes ?? null,
          });
        }
        await tx.loanItemUnit.update({
          where: { id: pu.id },
          data: { returned: true },
        });
      }
      const totalReturned = alreadyReturned + item.quantity;
      returnedByItem.set(pd.id, totalReturned);
      await tx.loanItem.update({
        where: { id: pd.id },
        data: { returnedQuantity: totalReturned },
      });

      effectiveItems.push({
        deviceId: pd.deviceId,
        quantity: item.quantity,
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
        items: { create: effectiveItems.map((d) => ({ deviceId: d.deviceId, quantity: d.quantity, condition: (d.condition ?? null) as any, notes: (d.notes ?? null) as any })) },
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
    for (const item of input.items) {
      const pd = (await tx.loanItem.findUnique({ where: { id: item.loanItemId! } }))!;
      await tx.loanReturnItem.create({
        data: {
          loanReturnId: loanReturn.id,
          loanItemId: item.loanItemId!,
          deviceId: pd.deviceId,
          quantity: item.quantity,
          condition: item.condition as any,
          notes: (item.notes ?? null) as any,
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
    for (const item of input.items) {
      await this.assertDevice(tx, item.deviceId);
      const available = await this.selectUnits(tx, item.deviceId, "AVAILABLE", item.quantity);
      if (available.length < item.quantity) {
        throw new HttpError(409, "NOT_ENOUGH_UNITS_FOR_DEVICE", { deviceId: item.deviceId });
      }
      await tx.deviceUnit.updateMany({
        where: { id: { in: available.map((u) => u.id) } },
        data: { departmentId: input.departmentId },
      });
    }
    const movement = await tx.movement.create({
      data: {
        type: "TRANSFER",
        createdById: authorId,
        departmentId: input.departmentId,
        reason: input.reason,
        notes: input.notes,
        items: { create: input.items.map((d) => ({ deviceId: d.deviceId, quantity: d.quantity })) },
      },
      include: { items: true },
    });
    await this.audit(tx, "MOVEMENT_TRANSFER", movement.id, authorId, input);
    return movement;
  }

  private async movementMaintenanceIn(tx: Tx, input: CreateMovementInput, authorId: string) {
    for (const item of input.items) {
      await this.assertDevice(tx, item.deviceId);
      const available = await this.resolveTargetUnits(
        tx,
        item,
        "AVAILABLE",
        "NOT_ENOUGH_UNITS"
      );
      await tx.deviceUnit.updateMany({
        where: { id: { in: available.map((u) => u.id) } },
        data: { status: "IN_MAINTENANCE" },
      });
    }
    const movement = await tx.movement.create({
      data: {
        type: "MAINTENANCE_IN",
        createdById: authorId,
        reason: input.reason,
        notes: input.notes,
        items: { create: input.items.map((d) => this.itemData(d) as any) },
      },
      include: { items: true },
    });
    await this.audit(tx, "MOVEMENT_MAINTENANCE_IN", movement.id, authorId, input);
    return movement;
  }

  private async movementMaintenanceOut(tx: Tx, input: CreateMovementInput, authorId: string) {
    const unitsRetirement: { deviceUnitId: string; deviceId: string; notes: string | null }[] = [];
    for (const item of input.items) {
      await this.assertDevice(tx, item.deviceId);
      const inMaintenance = await this.resolveTargetUnits(
        tx,
        item,
        "IN_MAINTENANCE",
        "NOT_ENOUGH_UNITS_IN_MAINTENANCE"
      );
      const newStatus = conditionToStatus(item.condition as Condition | null);
      for (const u of inMaintenance) {
        await tx.deviceUnit.update({
          where: { id: u.id },
          data: { status: newStatus },
        });
        if (newStatus === "RETIRED") {
          unitsRetirement.push({ deviceUnitId: u.id, deviceId: u.deviceId, notes: item.notes ?? null });
        }
      }
    }
    const movement = await tx.movement.create({
      data: {
        type: "MAINTENANCE_OUT",
        createdById: authorId,
        reason: input.reason,
        notes: input.notes,
        items: { create: input.items.map((d) => this.itemData(d) as any) },
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

    switch (source.type) {
      case "MAINTENANCE_IN": {
        for (const item of source.items) {
          const ids = await resolver(item, "IN_MAINTENANCE");
          await tx.deviceUnit.updateMany({
            where: { id: { in: ids } },
            data: { status: "AVAILABLE" },
          });
        }
        break;
      }
      case "MAINTENANCE_OUT": {
        for (const item of source.items) {
          if (item.condition === "BROKEN") continue;
          const ids = await resolver(item, "AVAILABLE");
          await tx.deviceUnit.updateMany({
            where: { id: { in: ids } },
            data: { status: "IN_MAINTENANCE" },
          });
        }
        break;
      }
      default:
        throw new HttpError(409, "MOVEMENT_NOT_REVERSIBLE");
    }

    await tx.movement.update({ where: { id: source.id }, data: { status: "CANCELLED" } });
    const reversion = await tx.movement.create({
      data: {
        type: "REVERSAL",
        createdById: authorId,
        reason: `Reversión de ${source.type}`,
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
    return this.db.$transaction(
      async (tx) => {
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

        const resourceChange = input.deviceId !== undefined || input.quantity !== undefined;
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
        if (resourceChange && !hasReturns) {
          const item = loan.items[0];
          if (!item) throw new HttpError(400, "LOAN_HAS_NO_ITEMS");
          const deviceId = input.deviceId ?? item.deviceId;
          const quantity = input.quantity ?? item.quantity;
          const newDevice = await tx.device.findUnique({ where: { id: deviceId } });
          if (!newDevice) throw new HttpError(404, "DEVICE_NOT_FOUND");

          // Liberar unidades prestadas (aún no devueltas) de este préstamo.
          for (const pu of item.units) {
            if (!pu.returned) {
              await tx.deviceUnit.update({
                where: { id: pu.deviceUnitId },
                data: { status: "AVAILABLE" },
              });
              await tx.loanItemUnit.delete({ where: { id: pu.id } });
            }
          }

          // Validar disponibilidad y asignar las nuevas unidades.
          const available = await tx.deviceUnit.findMany({
            where: { deviceId, status: "AVAILABLE" },
            orderBy: { assetTag: "asc" },
            take: quantity,
            select: UNIT_SELECT,
          });
          if (available.length < quantity) {
            throw new HttpError(409, "NOT_ENOUGH_UNITS_COUNT", { required: quantity, available: available.length });
          }
          await tx.loanItem.update({
            where: { id: item.id },
            data: { deviceId, quantity },
          });
          const deptId = (input.departmentId ?? loan.departmentId) || null;
          for (const u of available) {
            await tx.loanItemUnit.create({
              data: { loanItemId: item.id, deviceUnitId: u.id },
            });
            await tx.deviceUnit.update({
              where: { id: u.id },
              data: { status: "ON_LOAN", departmentId: deptId },
            });
          }
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
              const quantity = input.quantity ?? md.quantity;
              await tx.movementItem.update({
                where: { id: md.id },
                data: { deviceId, quantity },
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
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    );
  }

  async cancelLoan(id: string) {
    const loan = await this.db.loan.findUnique({ where: { id } });
    if (!loan) throw new HttpError(404, "LOAN_NOT_FOUND");
    if (loan.status === "RETURNED" || loan.status === "CANCELLED") {
      throw new HttpError(409, "LOAN_CLOSED");
    }
    return this.db.$transaction(async (tx) => {
      const items = await tx.loanItem.findMany({ where: { loanId: id } });
      for (const pd of items) {
        const pending = await tx.loanItemUnit.findMany({
          where: { loanItemId: pd.id, returned: false },
        });
        await tx.deviceUnit.updateMany({
          where: { id: { in: pending.map((u) => u.deviceUnitId) } },
          data: { status: "AVAILABLE" },
        });
        await tx.loanItemUnit.updateMany({
          where: { id: { in: pending.map((u) => u.id) } },
          data: { returned: true },
        });
        await tx.loanItem.update({ where: { id: pd.id }, data: { returnedQuantity: pd.quantity } });
      }
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
    input: unknown
  ) {
    const data = input as Record<string, unknown>;
    await this.auditPort.createLog(
      {
        action,
        entityType: "Movement",
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
      message: `${type} · ${count} detalle(s)`,
      targetId,
      deviceId: deviceId ?? undefined,
    }).catch(() => {});
  }
}