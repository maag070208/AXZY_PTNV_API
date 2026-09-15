import type { Prisma } from "@prisma/client";
import { prismaClient } from "@core/config/database";
import { HttpError } from "@core/middlewares/error.middleware";
import { broadcastDashboardEvent } from "@core/services/ably";
import {
  ci,
  orderByOf,
  type ITDataTableFetchParams,
  type ITDataTableResponse,
} from "@core/utils/table";
import type { CartaInput, CartaItemInput } from "../models/entity/carta.entity";
import { includeCartaFull, includeCartaLight } from "../mappers/carta.mapper";

const formatFolio = (prefix: string, n: number): string =>
  `${prefix}-${String(n).padStart(4, "0")}`;

interface AccessScope {
  userId?: string;
  role?: string;
  departmentId?: string | null;
}

type CartaForScope = {
  responsableId?: string | null;
  responsable?: { department?: { id?: string | null } | null } | null;
};

export class CartaService {
  constructor(private readonly db = prismaClient) {}

  async generateByType(typeId: string, creadoPorId?: string) {
    const result = await this.db.$transaction(async (tx) => {
      const type = await tx.deviceType.findUnique({ where: { id: typeId } });
      if (!type || !type.active) throw new HttpError(404, "Tipo de dispositivo no encontrado");

      const updated = await tx.deviceType.update({
        where: { id: typeId },
        data: { cartaContador: { increment: 1 } },
      });

      const folio = formatFolio(type.prefix, updated.cartaContador);

      const carta = await tx.cartaResponsiva.create({
        data: {
          consecutive: folio,
          numeroEmpleado: "",
          creadoPorId: creadoPorId ?? null,
          items: {
            create: [
              {
                descripcion: type.name,
                marca: "",
                modelo: "",
                controlActivos: "",
                numeroSerie: "N/A",
                nombreEquipo: "N/A",
              },
            ],
          },
        },
        include: includeCartaFull,
      });

      return {
        tipo: { code: type.code, name: type.name, prefix: type.prefix },
        contador: updated.cartaContador,
        carta,
      };
    });

    broadcastDashboardEvent({
      scope: "cartas",
      message: `Nueva carta responsiva ${result.carta.consecutive}`,
    }).catch(() => {});

    return result;
  }

  async list(search?: string, scope: AccessScope = {}) {
    const where: Prisma.CartaResponsivaWhereInput = this.baseWhere(scope);

    if (search) {
      where.OR = [
        { consecutive: { contains: search, mode: "insensitive" } },
        { numeroEmpleado: { contains: search, mode: "insensitive" } },
        { items: { some: { descripcion: { contains: search, mode: "insensitive" } } } },
      ];
    }

    return this.db.cartaResponsiva.findMany({
      where,
      orderBy: { creadoEn: "desc" },
      include: includeCartaFull,
    });
  }

  async table(
    params: ITDataTableFetchParams,
    scope: AccessScope = {}
  ): Promise<ITDataTableResponse<any>> {
    const { filters } = params;
    const where: Prisma.CartaResponsivaWhereInput = this.baseWhere(scope);

    if (filters.consecutivo) where.consecutive = ci(filters.consecutivo);
    if (filters.numeroEmpleado) where.numeroEmpleado = ci(filters.numeroEmpleado);
    if (filters.departamento) where.departamento = ci(filters.departamento);
    if (filters.empresa) where.empresa = ci(filters.empresa);
    if (filters.responsable) where.responsable = { name: ci(filters.responsable) };
    if (filters.items || filters.item) {
      const term = ci(filters.items ?? filters.item)!.contains;
      where.items = {
        some: {
          OR: [
            { descripcion: { contains: term, mode: "insensitive" } },
            { marca: { contains: term, mode: "insensitive" } },
            { modelo: { contains: term, mode: "insensitive" } },
            { controlActivos: { contains: term, mode: "insensitive" } },
            { numeroSerie: { contains: term, mode: "insensitive" } },
          ],
        },
      };
    }

    const orderBy = orderByOf(
      params.sort,
      {
        consecutivo: "consecutive",
        numeroEmpleado: "numeroEmpleado",
        departamento: "departamento",
        empresa: "empresa",
        fecha: "fecha",
        creadoEn: "creadoEn",
      },
      [{ creadoEn: "desc" }]
    );

    const [total, data] = await this.db.$transaction([
      this.db.cartaResponsiva.count({ where }),
      this.db.cartaResponsiva.findMany({
        where,
        orderBy: orderBy as any,
        skip: (params.page - 1) * params.limit,
        take: params.limit,
        include: includeCartaFull,
      }),
    ]);

    return { data, total };
  }

  async getById(id: string, scope: AccessScope = {}) {
    const carta = await this.db.cartaResponsiva.findUnique({
      where: { id },
      include: includeCartaFull,
    });
    if (!carta) throw new HttpError(404, `Carta ${id} no encontrada`);
    this.assertAuthorized(carta, scope);
    return carta;
  }

  create(input: CartaInput) {
    return this.db.$transaction(async (tx) => {
      // Auto-rellenar item desde el device si viene con deviceId
      const resolvedItem = await this.resolveItemFromDevice(tx, input.item);

      this.assertCompleteItem(resolvedItem);

      const consecutivo =
        input.consecutivo || (await this.consumeConsecutivoForDevice(tx, resolvedItem.deviceId));

      const carta = await tx.cartaResponsiva.create({
        data: {
          consecutive: consecutivo,
          fecha: input.fecha ? new Date(input.fecha) : new Date(),
          numeroEmpleado: input.numeroEmpleado ?? "",
          empresa: input.empresa ?? "Puerto Nuevo Hotel y Villas",
          departamento: input.departamento ?? "Departamento de Mantenimiento",
          creadoPorId: input.creadoPorId ?? null,
          responsableId: input.responsableId ?? null,
          encargadoId: input.encargadoId ?? null,
          departmentId: input.departmentId ?? null,
          areaBoss: input.areaBoss ?? null,
          deliveryBy: input.deliveryBy ?? "Departamento de Mantenimiento",
          items: { create: [this.toItemCreate(resolvedItem)] },
        },
        include: includeCartaFull,
      });

      // Candado de préstamo único: la reserva es un UPDATE condicionado
      // (estado DISPONIBLE y sin carta activa) — atómico en Postgres, así que
      // si dos usuarios intentan prestar el mismo equipo solo uno gana y el
      // otro recibe 409. La UNIQUE en Device.cartaActivaId lo blinda además a
      // nivel de BD. Si esto falla, el $transaction revierte la carta creada.
      if (resolvedItem.deviceId) {
        const claimed = await tx.device.updateMany({
          where: { id: resolvedItem.deviceId, estado: "DISPONIBLE", cartaActivaId: null },
          data: { estado: "ASIGNADO", cartaActivaId: carta.id },
        });
        if (claimed.count === 0) {
          throw new HttpError(
            409,
            "El dispositivo ya no está disponible (fue asignado por otra carta)"
          );
        }
      }

      return carta;
    });
  }

  async update(id: string, input: Partial<CartaInput>, scope: AccessScope = {}) {
    const existing = await this.db.cartaResponsiva.findUnique({
      where: { id },
      include: includeCartaLight,
    });
    if (!existing) throw new HttpError(404, `Carta ${id} no encontrada`);
    this.assertAuthorized(existing, scope);

    return this.db.$transaction(async (tx) => {
      const oldItems = await tx.cartaItem.findMany({ where: { cartaId: id } });

      let resolvedItem: CartaItemInput | null = null;
      if (input.item) {
        resolvedItem = await this.resolveItemFromDevice(tx, input.item);
        this.assertCompleteItem(resolvedItem);
        await tx.cartaItem.deleteMany({ where: { cartaId: id } });
      }

      const data: any = {
        consecutive: input.consecutivo ?? undefined,
        fecha: input.fecha ? new Date(input.fecha) : undefined,
        numeroEmpleado: input.numeroEmpleado ?? undefined,
        empresa: input.empresa ?? undefined,
        departamento: input.departamento ?? undefined,
        areaBoss: input.areaBoss ?? undefined,
        deliveryBy: input.deliveryBy ?? undefined,
      };
      if (input.responsableId !== undefined) data.responsableId = input.responsableId;
      if (input.encargadoId !== undefined) data.encargadoId = input.encargadoId;
      if (input.departmentId !== undefined) data.departmentId = input.departmentId;
      if (resolvedItem) {
        data.items = { create: [this.toItemCreate(resolvedItem)] };
      }

      const carta = await tx.cartaResponsiva.update({
        where: { id },
        data,
        include: includeCartaFull,
      });

      // Status tracking: si cambia deviceId, liberar el viejo y asignar el nuevo.
      // Ambos pasos van condicionados a la carta actual — el UPDATE condicionado
      // es atómico en BD y la UNIQUE en Device.cartaActivaId blinda el préstamo
      // único. Nunca se libera un equipo que otra carta ya tomó.
      if (resolvedItem && resolvedItem.deviceId) {
        const oldDeviceIds = oldItems.map((i) => i.deviceId).filter(Boolean) as string[];
        const isSameDevice = oldDeviceIds.includes(resolvedItem.deviceId);

        // Reservar el nuevo con la misma condición atómica que en create: solo
        // si sigue DISPONIBLE y sin carta activa. Si ya era el dispositivo de
        // esta carta, no hace falta (ya está ASIGNADO a este préstamo).
        if (!isSameDevice) {
          const claimed = await tx.device.updateMany({
            where: { id: resolvedItem.deviceId, estado: "DISPONIBLE", cartaActivaId: null },
            data: { estado: "ASIGNADO", cartaActivaId: id },
          });
          if (claimed.count === 0) {
            throw new HttpError(
              409,
              "El dispositivo ya no está disponible (fue asignado por otra carta)"
            );
          }
        }

        for (const oldId of oldDeviceIds) {
          // Solo se libera el equipo que sigue apuntando a ESTA carta; si otro
          // préstamo ya lo reasignó (cartaActivaId ≠ id) no se toca.
          if (oldId !== resolvedItem.deviceId) {
            await tx.device.updateMany({
              where: { id: oldId, cartaActivaId: id },
              data: { estado: "DISPONIBLE", cartaActivaId: null },
            });
          }
        }
      }

      return carta;
    });
  }

  async remove(id: string, scope: AccessScope = {}) {
    const existing = await this.db.cartaResponsiva.findUnique({
      where: { id },
      include: {
        responsable: { select: { department: { select: { id: true } } } },
        items: { select: { deviceId: true } },
      },
    });
    if (!existing) throw new HttpError(404, "Carta no encontrada");
    this.assertAuthorized(existing, scope);

    await this.db.$transaction(async (tx) => {
      await tx.cartaResponsiva.delete({ where: { id } });

      // Liberar los equipos que esta carta tenía en préstamo; si alguno ya fue
      // reasignado (cartaActivaId ≠ id) no se toca para no romper el candado.
      for (const item of existing.items) {
        if (!item.deviceId) continue;
        await tx.device.updateMany({
          where: { id: item.deviceId, cartaActivaId: id },
          data: { estado: "DISPONIBLE", cartaActivaId: null },
        });
      }
    });
  }

  async returnCarta(id: string, data: { returnedBy: string; returnCondition: string }, scope: AccessScope = {}) {
    const updated = await this.db.$transaction(async (tx) => {
      const carta = await tx.cartaResponsiva.findUnique({
        where: { id },
        include: includeCartaLight,
      });
      if (!carta) throw new HttpError(404, "Carta no encontrada");
      this.assertAuthorized(carta, scope);

      const updated = await tx.cartaResponsiva.update({
        where: { id },
        data: {
          returnDate: new Date(),
          returnedBy: data.returnedBy,
          returnCondition: data.returnCondition,
        },
        include: includeCartaFull,
      });

      // Liberar device (condicionado a que siga apuntando a ESTA carta, para no
      // soltar un equipo que otro préstamo ya tomó mientras corría la devolución).
      for (const item of carta.items) {
        if (item.deviceId) {
          await tx.device.updateMany({
            where: { id: item.deviceId, cartaActivaId: updated.id },
            data: { estado: "DISPONIBLE", cartaActivaId: null },
          });
        }
      }

      return updated;
    });

    broadcastDashboardEvent({
      scope: "cartas",
      message: `Devolución registrada: carta ${updated.consecutive}`,
    }).catch(() => {});

    return updated;
  }

  undoReturn(id: string, scope: AccessScope = {}) {
    return this.db.$transaction(async (tx) => {
      const carta = await tx.cartaResponsiva.findUnique({
        where: { id },
        include: includeCartaLight,
      });
      if (!carta) throw new HttpError(404, "Carta no encontrada");
      this.assertAuthorized(carta, scope);

      const updated = await tx.cartaResponsiva.update({
        where: { id },
        data: {
          returnDate: null,
          returnedBy: null,
          returnCondition: null,
        },
        include: includeCartaFull,
      });

      // Re-asignar device (reclamación condicionada: solo si sigue DISPONIBLE y sin
      // carta activa). Si otro préstamo ya tomó el equipo, no se puede revertir.
      for (const item of carta.items) {
        if (item.deviceId) {
          const claimed = await tx.device.updateMany({
            where: { id: item.deviceId, estado: "DISPONIBLE", cartaActivaId: null },
            data: { estado: "ASIGNADO", cartaActivaId: updated.id },
          });
          if (claimed.count === 0) {
            throw new HttpError(
              409,
              "El dispositivo ya fue prestado de nuevo; no se puede revertir la devolución"
            );
          }
        }
      }

      return updated;
    });
  }

  // ─── Permisos por rol ───────────────────────────────────────────────

  private baseWhere(scope: AccessScope): Prisma.CartaResponsivaWhereInput {
    const where: Prisma.CartaResponsivaWhereInput = {};
    if (scope.role === "JEFE_DE_AREA" && scope.departmentId) {
      where.responsable = { departmentId: scope.departmentId };
    } else if (scope.role === "EMPLEADO" && scope.userId) {
      where.responsableId = scope.userId;
    }
    return where;
  }

  private assertAuthorized(carta: CartaForScope, scope: AccessScope) {
    if (scope.role === "EMPLEADO" && carta.responsableId !== scope.userId) {
      throw new HttpError(403, "No autorizado");
    }
    if (
      scope.role === "JEFE_DE_AREA" &&
      scope.departmentId &&
      carta.responsable?.department?.id !== scope.departmentId
    ) {
      throw new HttpError(403, "No autorizado");
    }
  }

  // ─── Helpers privados ───────────────────────────────────────────────

  private assertCompleteItem(item: CartaItemInput) {
    if (!item.descripcion || !item.marca || !item.modelo || !item.controlActivos) {
      throw new HttpError(
        400,
        "Faltan datos del dispositivo (descripcion/marca/modelo/controlActivos)"
      );
    }
  }

  private toItemCreate(item: CartaItemInput) {
    return {
      deviceId: item.deviceId ?? null,
      descripcion: item.descripcion!,
      marca: item.marca!,
      modelo: item.modelo!,
      numeroSerie: item.numeroSerie ?? "N/A",
      nombreEquipo: item.nombreEquipo ?? "N/A",
      controlActivos: item.controlActivos!,
      area: item.area ?? "MANTENIMIENTO",
    };
  }

  // Si el item viene con deviceId, auto-rellena los campos físicos desde el
  // Device (descripcion, marca, modelo, controlActivos, etc.).
  private async resolveItemFromDevice(
    tx: Prisma.TransactionClient,
    item: CartaItemInput
  ): Promise<CartaItemInput> {
    if (!item.deviceId) return item;
    const dev = await tx.device.findUnique({ where: { id: item.deviceId } });
    if (!dev) throw new HttpError(404, "Dispositivo no encontrado");
    return {
      ...item,
      descripcion: item.descripcion ?? dev.descripcion,
      marca: item.marca ?? dev.marca,
      modelo: item.modelo ?? dev.modelo,
      controlActivos: item.controlActivos ?? dev.controlActivos,
      numeroSerie: item.numeroSerie ?? dev.numeroSerie ?? "N/A",
      nombreEquipo: item.nombreEquipo ?? dev.nombreEquipo ?? "N/A",
      area: item.area ?? dev.area ?? "MANTENIMIENTO",
    };
  }

  // Si la carta va ligada a un dispositivo, el folio se genera desde el
  // contador de su DeviceType (prefix + cartaContador + 1), igual que el
  // flujo "Generar por tipo". Si no hay dispositivo, cae al singleton global.
  private async consumeConsecutivoForDevice(
    tx: Prisma.TransactionClient,
    deviceId?: string | null
  ): Promise<string> {
    if (deviceId) {
      const dev = await tx.device.findUnique({
        where: { id: deviceId },
        include: { type: true },
      });
      if (dev?.type?.active) {
        const prefix = dev.type.prefix;
        // El contador pudo quedar desincronizado con cartas creadas a mano
        // (ej. folio TBE-0001 existente con vista en 0). El folio siempre se
        // calcula por ENCIMA del máximo ya persistido con ese prefijo.
        const existing = await tx.cartaResponsiva.findMany({
          where: { consecutive: { startsWith: `${prefix}-`, mode: "insensitive" } },
          select: { consecutive: true },
        });
        const existingMax = existing.reduce((max, c) => {
          const n = parseInt(c.consecutive.slice(prefix.length + 1), 10);
          return Number.isFinite(n) ? Math.max(max, n) : max;
        }, 0);

        const updated = await tx.deviceType.update({
          where: { id: dev.type.id },
          data: { cartaContador: { increment: 1 } },
        });
        const contador = Math.max(updated.cartaContador, existingMax + 1);
        return formatFolio(prefix, contador);
      }
    }
    return this.consumeConsecutivo(tx);
  }

  // El consecutivo se genera y consume DENTRO de la misma transacción que crea
  // la carta, y solo después de validar todo — así una carta fallida nunca
  // "quema" un folio.
  private async consumeConsecutivo(tx: Prisma.TransactionClient): Promise<string> {
    const row = await tx.consecutivo.upsert({
      where: { id: "singleton" },
      update: { contador: { increment: 1 } },
      create: { id: "singleton", prefijo: "F-MMTO-", contador: 1 },
    });
    return `${row.prefijo}${String(row.contador).padStart(4, "0")}`;
  }
}