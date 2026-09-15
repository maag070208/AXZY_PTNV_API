import { prismaClient } from "@core/config/database";
import { HttpError } from "@core/middlewares/error.middleware";
import { broadcastDashboardEvent } from "@core/services/ably";
import {
  ci,
  orderByOf,
  type ITDataTableFetchParams,
  type ITDataTableResponse,
} from "@core/utils/table";
import { randomUUID } from "node:crypto";
import type {
  DeviceBatchInput,
  DeviceFilter,
  DeviceInput,
} from "../models/entity/device.entity";
import { DeviceFieldValidator } from "./device-field-validator";
import type { DeviceTypePort } from "./ports";

const includeFull = {
  type: true,
  department: { select: { id: true, name: true } },
  history: {
    include: { autor: { select: { id: true, name: true, username: true } } },
    orderBy: { createdAt: "asc" as const },
  },
  // Carta vigente (sin devolución) de la que este equipo forma parte — usada en
  // el detalle para saber a qué carta está prestado. Se dejan fuera las históricas.
  cartaItems: {
    where: { carta: { returnDate: null } },
    include: {
      carta: {
        include: {
          creadoPor: { select: { id: true, name: true, username: true } },
          responsable: { select: { id: true, name: true, numeroEmpleado: true } },
          encargado: { select: { id: true, name: true } },
          department: { select: { id: true, name: true } },
        },
      },
    },
  },
};

export class DeviceService {
  private readonly fields: DeviceFieldValidator;

  constructor(
    private readonly deviceTypePort: DeviceTypePort,
    private readonly db = prismaClient
  ) {
    this.fields = new DeviceFieldValidator(deviceTypePort);
  }

  list(filters: DeviceFilter) {
    const where: any = {};
    if (filters.typeId) where.typeId = filters.typeId;
    if (filters.estado) where.estado = filters.estado;
    // Candado estructural: los equipos en préstamo vigente (carta activa sin
    // devolución) se excluyen aunque su columna estado tenga drift histórico.
    if (filters.disponibleParaCarta) where.cartaActivaId = null;
    if (filters.q) {
      where.OR = [
        { descripcion: { contains: filters.q, mode: "insensitive" } },
        { marca: { contains: filters.q, mode: "insensitive" } },
        { modelo: { contains: filters.q, mode: "insensitive" } },
        { controlActivos: { contains: filters.q, mode: "insensitive" } },
        { numeroSerie: { contains: filters.q, mode: "insensitive" } },
        { ip: { contains: filters.q, mode: "insensitive" } },
        { macAddress: { contains: filters.q, mode: "insensitive" } },
      ];
    }

    return this.db.device.findMany({
      where,
      include: { type: true },
      orderBy: { createdAt: "desc" },
    });
  }

  /**
   * Kardex de disponibilidad: todos los equipos (no BAJA) agrupados por tipo,
   * cada uno con su carta vigente (sin devolución) si está prestado. Vista de
   * inventario de un vistazo: quién tiene qué equipo y desde cuándo.
   */
  async availability() {
    const devices = await this.db.device.findMany({
      where: { estado: { not: "BAJA" } },
      include: {
        type: { select: { id: true, code: true, name: true } },
        department: { select: { id: true, name: true } },
        cartaItems: {
          where: { carta: { returnDate: null } },
          orderBy: { carta: { fecha: "desc" } },
          include: {
            carta: {
              select: {
                consecutive: true,
                fecha: true,
                numeroEmpleado: true,
                departamento: true,
                deliveryBy: true,
                responsable: { select: { id: true, name: true, numeroEmpleado: true } },
                encargado: { select: { id: true, name: true } },
                department: { select: { id: true, name: true } },
              },
            },
          },
        },
      },
      orderBy: [{ type: { name: "asc" } }, { controlActivos: "asc" }],
    });

    const groups: Array<{
      typeId: string;
      code: string;
      name: string;
      total: number;
      disponible: number;
      asignado: number;
      devices: Array<{
        id: string;
        controlActivos: string;
        descripcion: string;
        marca: string;
        modelo: string;
        estado: string;
        area: string;
        departmentName?: string | null;
        carta?: {
          consecutive: string;
          fecha: Date;
          numeroEmpleado: string;
          departamento: string;
          deliveryBy: string;
          responsable?: string | null;
          encargado?: string | null;
          departmentName?: string | null;
        } | null;
      }>;
    }> = [];

    const index = new Map<string, (typeof groups)[number]>();

    for (const dev of devices) {
      const active = dev.cartaItems[0];
      const typeKey = dev.type?.id ?? "sin-tipo";
      let group = index.get(typeKey);
      if (!group) {
        group = {
          typeId: typeKey,
          code: dev.type?.code ?? "",
          name: dev.type?.name ?? "Sin tipo",
          total: 0,
          disponible: 0,
          asignado: 0,
          devices: [],
        };
        index.set(typeKey, group);
        groups.push(group);
      }

      group.total += 1;
      if (dev.estado === "ASIGNADO") group.asignado += 1;
      else if (dev.estado === "DISPONIBLE") group.disponible += 1;

      const carta = active?.carta
        ? {
            consecutive: active.carta.consecutive,
            fecha: active.carta.fecha,
            numeroEmpleado: active.carta.numeroEmpleado,
            departamento: active.carta.departamento,
            deliveryBy: active.carta.deliveryBy,
            responsable: active.carta.responsable?.name ?? null,
            encargado: active.carta.encargado?.name ?? null,
            departmentName: active.carta.department?.name ?? null,
          }
        : null;

      group.devices.push({
        id: dev.id,
        controlActivos: dev.controlActivos,
        descripcion: dev.descripcion,
        marca: dev.marca,
        modelo: dev.modelo,
        estado: dev.estado,
        area: dev.area,
        departmentName: dev.department?.name,
        carta,
      });
    }

    return groups;
  }

  async table(params: ITDataTableFetchParams): Promise<ITDataTableResponse<any>> {
    const { filters } = params;
    const where: any = {};

    if (filters.typeId) where.typeId = String(filters.typeId);
    if (filters.estado) where.estado = String(filters.estado);
    if (filters.controlActivos) where.controlActivos = ci(filters.controlActivos);
    if (filters.descripcion) where.descripcion = ci(filters.descripcion);
    if (filters.marca) where.marca = ci(filters.marca);
    if (filters.modelo) where.modelo = ci(filters.modelo);
    if (filters.type) where.type = { name: ci(filters.type) };
    if (filters.q) {
      where.OR = [
        { descripcion: { contains: String(filters.q), mode: "insensitive" } },
        { marca: { contains: String(filters.q), mode: "insensitive" } },
        { modelo: { contains: String(filters.q), mode: "insensitive" } },
        { controlActivos: { contains: String(filters.q), mode: "insensitive" } },
        { numeroSerie: { contains: String(filters.q), mode: "insensitive" } },
        { ip: { contains: String(filters.q), mode: "insensitive" } },
        { macAddress: { contains: String(filters.q), mode: "insensitive" } },
      ];
    }

    const orderBy = orderByOf(
      params.sort,
      {
        controlActivos: "controlActivos",
        descripcion: "descripcion",
        estado: "estado",
        typeId: (d: "asc" | "desc") => ({ type: { name: d } }),
        departmentId: (d: "asc" | "desc") => ({ department: { name: d } }),
        createdAt: "createdAt",
      },
      [{ createdAt: "desc" }]
    );

    // Se traen todos los que cumplen el filtro y se agrupan por lote: un lote
    // de N unidades dadas de alta juntas se muestra como UN solo renglón (con
    // su cantidad). El renglón usa el identificador de la primera unidad.
    const all = await this.db.device.findMany({
      where,
      include: { type: true },
      orderBy: orderBy as any,
    });

    const loteIds = Array.from(
      new Set(all.map((d) => d.loteId).filter((v): v is string => !!v))
    );
    const loteSizes = await this.buildLoteSizes(loteIds);

    const seenLotes = new Set<string>();
    const rows: any[] = [];
    for (const d of all) {
      if (d.loteId) {
        if (seenLotes.has(d.loteId)) continue;
        seenLotes.add(d.loteId);
        const loteUnits = all.filter((x) => x.loteId === d.loteId);
        const count = (st: string) => loteUnits.filter((x) => x.estado === st).length;
        rows.push({
          ...d,
          loteId: d.loteId,
          loteSize: loteSizes[d.loteId] ?? loteUnits.length,
          loteCount: {
            disponible: count("DISPONIBLE"),
            asignado: count("ASIGNADO"),
            baja: count("BAJA"),
          },
        });
      } else {
        rows.push({ ...d, loteId: null, loteSize: 1 });
      }
    }

    const total = rows.length;
    const data = rows.slice(
      (params.page - 1) * params.limit,
      (params.page - 1) * params.limit + params.limit
    );

    return { data, total };
  }

  async getById(id: string) {
    const d = await this.db.device.findUnique({
      where: { id },
      include: includeFull,
    });
    if (!d) throw new HttpError(404, "Dispositivo no encontrado");
    const loteSizes = d.loteId ? await this.buildLoteSizes([d.loteId]) : {};
    return {
      ...d,
      loteSize: d.loteId ? loteSizes[d.loteId] ?? 1 : 1,
    };
  }

  async summary() {
    const [total, disponible, asignado, baja, tipos] = await Promise.all([
      this.db.device.count(),
      this.db.device.count({ where: { estado: "DISPONIBLE" } }),
      this.db.device.count({ where: { estado: "ASIGNADO" } }),
      this.db.device.count({ where: { estado: "BAJA" } }),
      this.db.deviceType.count({ where: { active: true } }),
    ]);
    return { total, disponible, asignado, baja, tipos };
  }

  async create(input: DeviceInput, autorId?: string) {
    const device = await this.db.$transaction(async (tx) => {
      const type = await tx.deviceType.findUnique({ where: { id: input.typeId } });
      if (!type || !type.active) {
        throw new HttpError(400, "Tipo de dispositivo inválido");
      }

      const values = {
        numeroSerie: this.fields.normalize(type, "numeroSerie", input.numeroSerie),
        nombreEquipo: this.fields.normalize(type, "nombreEquipo", input.nombreEquipo),
        ip: this.fields.normalize(type, "ip", input.ip),
        macAddress: this.fields.normalize(type, "macAddress", input.macAddress),
        sistemaOp: this.fields.normalize(type, "sistemaOp", input.sistemaOp),
        ram: this.fields.normalize(type, "ram", input.ram),
        almacenamiento: this.fields.normalize(type, "almacenamiento", input.almacenamiento),
      };
      this.fields.validateRequired(type, values);

      if (input.departmentId) {
        const department = await tx.department.findUnique({ where: { id: input.departmentId } });
        if (!department) throw new HttpError(400, "Departamento inválido");
      }

      const newCounter = type.contador + 1;
      const controlActivos = this.deviceTypePort.formatPrefix(type.prefix, newCounter);

      const device = await tx.device.create({
        data: {
          typeId: input.typeId,
          controlActivos,
          descripcion: input.descripcion,
          marca: input.marca,
          modelo: input.modelo,
          numeroSerie: values.numeroSerie ?? null,
          nombreEquipo: values.nombreEquipo ?? null,
          area: input.area ?? "SISTEMAS",
          estado: input.estado ?? "DISPONIBLE",
          departmentId: input.departmentId || null,
          ip: values.ip ?? null,
          macAddress: values.macAddress ?? null,
          sistemaOp: values.sistemaOp ?? null,
          ram: values.ram ?? null,
          almacenamiento: values.almacenamiento ?? null,
        },
        include: { type: true },
      });

      await tx.deviceType.update({
        where: { id: input.typeId },
        data: { contador: newCounter },
      });

      await tx.deviceHistory.create({
        data: {
          deviceId: device.id,
          type: "CREATED",
          detail: `${device.marca} ${device.modelo} · ${device.controlActivos} · IP ${values.ip ?? "N/A"} · MAC ${values.macAddress ?? "N/A"}`,
          autorId: autorId ?? null,
        },
      });

      return device;
    });

    broadcastDashboardEvent({
      scope: "devices",
      message: `Alta de dispositivo ${device.controlActivos}`,
    }).catch(() => {});

    return device;
  }

  async createBatch(input: DeviceBatchInput, autorId?: string) {
    const created = await this.db.$transaction(async (tx) => {
      const type = await tx.deviceType.findUnique({ where: { id: input.typeId } });
      if (!type || !type.active) {
        throw new HttpError(400, "Tipo de dispositivo inválido");
      }

      if (input.departmentId) {
        const department = await tx.department.findUnique({ where: { id: input.departmentId } });
        if (!department) throw new HttpError(400, "Departamento inválido");
      }

      const shared = {
        sistemaOp: this.fields.normalize(type, "sistemaOp", input.sistemaOp),
        ram: this.fields.normalize(type, "ram", input.ram),
        almacenamiento: this.fields.normalize(type, "almacenamiento", input.almacenamiento),
      };

      // Validación temprana de duplicados dentro del mismo lote
      const seenSeries = new Set<string>();
      const seenMacs = new Set<string>();
      const seenIps = new Set<string>();
      input.units.forEach((u, idx) => {
        if (u.numeroSerie) {
          const key = u.numeroSerie.trim().toUpperCase();
          if (key && seenSeries.has(key)) {
            throw new HttpError(400, `Número de serie duplicado en el lote (unidad #${idx + 1}): ${u.numeroSerie}`);
          }
          if (key) seenSeries.add(key);
        }
        if (u.macAddress) {
          const key = u.macAddress.trim().toUpperCase();
          if (seenMacs.has(key)) {
            throw new HttpError(400, `MAC Address duplicada en el lote (unidad #${idx + 1}): ${u.macAddress}`);
          }
          seenMacs.add(key);
        }
        if (u.ip) {
          const key = u.ip.trim();
          if (seenIps.has(key)) {
            throw new HttpError(400, `IP duplicada en el lote (unidad #${idx + 1}): ${u.ip}`);
          }
          seenIps.add(key);
        }
      });

      const created = [];
      let counter = type.contador;
      const loteId = randomUUID();

      for (let i = 0; i < input.units.length; i++) {
        const unit = input.units[i];
        const values = {
          numeroSerie: this.fields.normalize(type, "numeroSerie", unit.numeroSerie),
          nombreEquipo: this.fields.normalize(type, "nombreEquipo", unit.nombreEquipo),
          ip: this.fields.normalize(type, "ip", unit.ip),
          macAddress: this.fields.normalize(type, "macAddress", unit.macAddress),
          ...shared,
        };
        this.fields.validateRequired(type, values);

        counter += 1;
        const controlActivos = this.deviceTypePort.formatPrefix(type.prefix, counter);

        const device = await tx.device.create({
          data: {
            typeId: input.typeId,
            controlActivos,
            descripcion: input.descripcion,
            marca: input.marca,
            modelo: input.modelo,
            numeroSerie: values.numeroSerie ?? null,
            nombreEquipo: values.nombreEquipo ?? null,
            area: input.area ?? "SISTEMAS",
            estado: input.estado ?? "DISPONIBLE",
            departmentId: input.departmentId || null,
            ip: values.ip ?? null,
            macAddress: values.macAddress ?? null,
            sistemaOp: values.sistemaOp ?? null,
            ram: values.ram ?? null,
            almacenamiento: values.almacenamiento ?? null,
            loteId,
          },
          include: { type: true },
        });

        await tx.deviceHistory.create({
          data: {
            deviceId: device.id,
            type: "CREATED",
            detail: `Alta por lote (${i + 1}/${input.units.length}) · ${device.marca} ${device.modelo} · ${device.controlActivos} · IP ${values.ip ?? "N/A"} · MAC ${values.macAddress ?? "N/A"}`,
            autorId: autorId ?? null,
          },
        });

        created.push(device);
      }

      await tx.deviceType.update({
        where: { id: input.typeId },
        data: { contador: counter },
      });

      return created;
    });

    broadcastDashboardEvent({
      scope: "devices",
      message: `Alta por lote de ${created.length} dispositivo(s)`,
    }).catch(() => {});

    return created;
  }

  async update(id: string, data: Partial<DeviceInput>, autorId?: string) {
    const existing = await this.db.device.findUnique({ where: { id } });
    if (!existing) throw new HttpError(404, "Dispositivo no encontrado");

    // Bloqueo: un dispositivo ASIGNADO no se puede editar salvo que la propia
    // transición salga de ese estado (p. ej. al registrar la devolución).
    if (existing.estado === "ASIGNADO") {
      const changingAwayFromAssigned = !!data.estado && data.estado !== "ASIGNADO";
      if (!changingAwayFromAssigned) {
        throw new HttpError(
          409,
          `El dispositivo ${existing.controlActivos} está asignado. Debe registrarse su devolución antes de poder editarlo.`
        );
      }
    }

    // Candado de préstamo: el estado ASIGNADO solo lo administra el flujo de
    // cartas responsivas (creación/edición/reversión de devolución). No se
    // permite marcarlo manualmente desde el catálogo.
    if (data.estado === "ASIGNADO") {
      throw new HttpError(
        409,
        `El dispositivo ${existing.controlActivos} solo se asigna mediante una carta responsiva (creación, cambio de dispositivo o reversión de devolución).`
      );
    }

    // Liberación manual hacia DISPONIBLE también libera el candado estructural
    // (cartaActivaId): sin esto el préstamo único quedaría bloqueado en la BD.
    if (existing.estado === "ASIGNADO" && data.estado === "DISPONIBLE") {
      (data as any).cartaActivaId = null;
    }

    if (data.departmentId !== undefined) {
      if (data.departmentId) {
        const department = await this.db.department.findUnique({ where: { id: data.departmentId } });
        if (!department) throw new HttpError(400, "Departamento inválido");
      } else {
        // Cadena vacía = "quitar el departamento fijo" (mismo criterio que el
        // resto de los campos opcionales de este endpoint).
        (data as any).departmentId = null;
      }
    }

    if (data.estado && data.estado !== existing.estado) {
      const statusLabels: Record<string, string> = {
        DISPONIBLE: "Disponible",
        ASIGNADO: "Asignado",
        BAJA: "Baja (retirado)",
      };
      await this.db.deviceHistory.create({
        data: {
          deviceId: id,
          // ASIGNADO no puede llegar aquí: se bloquea más arriba (solo lo
          // administra el flujo de cartas). Cambio manual = RETIRED o RETURNED.
          type: data.estado === "BAJA" ? "RETIRED" : "RETURNED",
          detail: `Estado cambiado a ${statusLabels[data.estado] ?? data.estado}`,
          autorId: autorId ?? null,
        },
      });
      broadcastDashboardEvent({
        scope: "devices",
        message: `${existing.controlActivos} cambió a ${statusLabels[data.estado] ?? data.estado}`,
      }).catch(() => {});
    }

    if (data.typeId) {
      return this.db.$transaction(async (tx) => {
        const newType = await tx.deviceType.findUnique({ where: { id: data.typeId! } });
        if (!newType || !newType.active) {
          throw new HttpError(400, "Tipo de dispositivo inválido");
        }

        const values = {
          numeroSerie: this.fields.normalize(newType, "numeroSerie", data.numeroSerie),
          nombreEquipo: this.fields.normalize(newType, "nombreEquipo", data.nombreEquipo),
          ip: this.fields.normalize(newType, "ip", data.ip),
          macAddress: this.fields.normalize(newType, "macAddress", data.macAddress),
          sistemaOp: this.fields.normalize(newType, "sistemaOp", data.sistemaOp),
          ram: this.fields.normalize(newType, "ram", data.ram),
          almacenamiento: this.fields.normalize(newType, "almacenamiento", data.almacenamiento),
        };
        this.fields.validateRequired(newType, values);

        const newCounter = newType.contador + 1;
        const controlActivos = this.deviceTypePort.formatPrefix(newType.prefix, newCounter);

        const device = await tx.device.update({
          where: { id },
          data: {
            ...data,
            controlActivos,
            numeroSerie: values.numeroSerie === undefined ? undefined : values.numeroSerie,
            nombreEquipo: values.nombreEquipo === undefined ? undefined : values.nombreEquipo,
            ip: values.ip === undefined ? undefined : values.ip,
            macAddress: values.macAddress === undefined ? undefined : values.macAddress,
            sistemaOp: values.sistemaOp === undefined ? undefined : values.sistemaOp,
            ram: values.ram === undefined ? undefined : values.ram,
            almacenamiento: values.almacenamiento === undefined ? undefined : values.almacenamiento,
          },
          include: { type: true },
        });

        await tx.deviceType.update({
          where: { id: data.typeId! },
          data: { contador: newCounter },
        });

        await tx.deviceHistory.create({
          data: {
            deviceId: id,
            type: "UPDATED",
            detail: "Tipo de dispositivo cambiado",
            autorId: autorId ?? null,
          },
        });

        return device;
      });
    }

    // Validar specs TIC contra el tipo actual (sin cambio de tipo)
    if (
      data.ip !== undefined ||
      data.macAddress !== undefined ||
      data.sistemaOp !== undefined ||
      data.ram !== undefined ||
      data.almacenamiento !== undefined
    ) {
      const currentType = await this.db.deviceType.findUnique({
        where: { id: existing.typeId },
      });
      if (currentType) {
        this.fields.normalize(currentType, "numeroSerie", data.numeroSerie);
        this.fields.normalize(currentType, "nombreEquipo", data.nombreEquipo);
        this.fields.normalize(currentType, "ip", data.ip);
        this.fields.normalize(currentType, "macAddress", data.macAddress);
        this.fields.normalize(currentType, "sistemaOp", data.sistemaOp);
        this.fields.normalize(currentType, "ram", data.ram);
        this.fields.normalize(currentType, "almacenamiento", data.almacenamiento);
      }
    }

    const changedFields: string[] = [];
    const fieldLabels: Record<string, string> = {
      descripcion: "Descripción",
      marca: "Marca",
      modelo: "Modelo",
      numeroSerie: "Número de serie",
      nombreEquipo: "Nombre de equipo",
      area: "Área",
      departmentId: "Departamento",
      ip: "IP",
      macAddress: "MAC Address",
      sistemaOp: "Sistema Operativo",
      ram: "RAM",
      almacenamiento: "Almacenamiento",
    };
    for (const [key, label] of Object.entries(fieldLabels)) {
      const newVal = (data as any)[key];
      if (newVal !== undefined && newVal !== (existing as any)[key]) {
        changedFields.push(`${label}: ${newVal}`);
      }
    }

    if (changedFields.length > 0) {
      await this.db.deviceHistory.create({
        data: {
          deviceId: id,
          type: "UPDATED",
          detail: changedFields.join(", "),
          autorId: autorId ?? null,
        },
      });
    }

    return this.db.device.update({
      where: { id },
      data,
      include: { type: true },
    });
  }

  async remove(id: string, autorId?: string, force = false) {
    const existing = await this.db.device.findUnique({ where: { id } });
    if (!existing) throw new HttpError(404, "Dispositivo no encontrado");

    if (existing.estado === "ASIGNADO" && !force) {
      throw new HttpError(
        409,
        `El dispositivo ${existing.controlActivos} está asignado. Registre su devolución antes de dar de baja, o fuerce la eliminación.`
      );
    }

    if (force) {
      await this.db.$transaction([
        this.db.cartaItem.updateMany({ where: { deviceId: id }, data: { deviceId: null } }),
        this.db.materialOutput.updateMany({ where: { deviceId: id }, data: { deviceId: null } }),
      ]);
      const data = await this.db.device.delete({ where: { id } });
      return { soft: false, forced: true, data };
    }

    if (existing.estado !== "BAJA") {
      const device = await this.db.$transaction(async (tx) => {
        await tx.deviceHistory.create({
          data: {
            deviceId: id,
            type: "RETIRED",
            detail: "Dispositivo dado de baja",
            autorId: autorId ?? null,
          },
        });
        return tx.device.update({ where: { id }, data: { estado: "BAJA" } });
      });
      broadcastDashboardEvent({
        scope: "devices",
        message: `Dispositivo ${existing.controlActivos} dado de baja`,
      }).catch(() => {});
      return { soft: true, data: device };
    }

    const data = await this.db.device.delete({ where: { id } });
    return { soft: false, data };
  }

  private async buildLoteSizes(loteIds: string[]): Promise<Record<string, number>> {
    if (loteIds.length === 0) return {};
    const grouped = await this.db.device.groupBy({
      by: ["loteId"],
      where: { loteId: { in: loteIds } },
      _count: { _all: true },
    });
    return Object.fromEntries(
      grouped.map((g) => [g.loteId as string, g._count._all as number])
    );
  }
}