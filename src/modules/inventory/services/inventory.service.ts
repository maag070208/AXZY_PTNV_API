import { prismaClient } from "@core/config/database";
import { HttpError } from "@core/middlewares/error.middleware";
import { broadcastDashboardEvent, broadcastTicketEvent } from "@core/services/ably";
import { paginatedQuery } from "@core/db/table";
import {
  ci,
  orderByOf,
  type ITDataTableFetchParams,
  type ITDataTableResponse,
} from "@core/utils/table";
import type { AuditPort } from "../../audit/models/entity/audit.entity";
import type { MovementFilters, MovementInput } from "../models/entity/inventory.entity";

export class InventoryService {
  constructor(
    private readonly auditPort: AuditPort,
    private readonly db = prismaClient
  ) {}

  async list(params: MovementFilters) {
    const where: any = {};

    if (params.deviceId) where.deviceId = params.deviceId;
    if (params.locationId) where.locationId = params.locationId;
    if (params.start || params.end) {
      where.createdAt = {};
      if (params.start) where.createdAt.gte = new Date(params.start);
      if (params.end) where.createdAt.lte = new Date(params.end);
    }

    return this.db.inventoryMovement.findMany({
      where,
      orderBy: { createdAt: "desc" },
      include: {
        device: { include: { type: true } },
        location: true,
        user: { select: { id: true, name: true, username: true } },
      },
    });
  }

  async movementsTable(params: ITDataTableFetchParams): Promise<ITDataTableResponse<any>> {
    const { filters, sort } = params;
    const where: any = {};

    if (filters.tipo) where.tipo = String(filters.tipo);
    if (filters.condicion) where.condicion = String(filters.condicion);
    if (filters.ubicacion) where.location = { is: { lugar: ci(filters.ubicacion) } };
    if (filters.deviceId) where.deviceId = String(filters.deviceId);

    if (filters.search) {
      const search = ci(filters.search);
      where.device = {
        is: {
          OR: [
            { controlActivos: search },
            { descripcion: search },
            { marca: search },
            { modelo: search },
            { numeroSerie: search },
            { nombreEquipo: search },
          ],
        },
      };
    }

    const start = filters.start as string | undefined;
    const end = filters.end as string | undefined;
    if (start || end) {
      where.createdAt = {};
      if (start) where.createdAt.gte = new Date(start);
      if (end) where.createdAt.lte = new Date(end);
    }

    const orderBy = orderByOf(
      sort,
      { createdAt: "createdAt", tipo: "tipo" },
      [{ createdAt: "desc" }]
    );

    return paginatedQuery<any>({
      model: this.db.inventoryMovement,
      where: where as Record<string, unknown>,
      orderBy: orderBy as unknown as never[],
      include: {
        device: { include: { type: true } },
        location: true,
        user: { select: { id: true, name: true, username: true } },
      } as never,
      page: params.page,
      limit: params.limit,
    });
  }

  async getKardex(deviceId: string) {
    const device = await this.db.device.findUnique({
      where: { id: deviceId },
      include: { type: true },
    });
    if (!device) throw new HttpError(404, "Dispositivo no encontrado");

    const movements = await this.db.inventoryMovement.findMany({
      where: { deviceId },
      orderBy: { createdAt: "asc" },
      include: {
        location: true,
        user: { select: { id: true, name: true, username: true } },
      },
    });

    return { device, movements };
  }

  async registerMovement(data: MovementInput) {
    // Toda la operación queda dentro de una sola transacción: o se aplica
    // todo, o no se aplica nada.
    let autoTicketId: string | null = null;
    const movement = await this.db.$transaction(async (tx) => {
      const device = await tx.device.findUnique({
        where: { id: data.deviceId },
        include: { type: true, location: true },
      });
      if (!device) throw new HttpError(404, "Dispositivo no encontrado");

      // Un dispositivo dado de baja ya no admite más movimientos.
      if (device.estado === "BAJA" && data.tipo !== "BAJA") {
        throw new HttpError(
          409,
          "El dispositivo ya fue dado de baja y no admite más movimientos de inventario"
        );
      }

      const previousState = {
        estado: device.estado,
        locationId: device.locationId,
        location: device.location
          ? {
              id: device.location.id,
              lugar: device.location.lugar,
            }
          : null,
      };

      let newEstado = device.estado;
      let newLocationId = device.locationId;
      let prestamoId = data.prestamoId || null;
      let closedCartaId: string | null = null;

      if (data.tipo === "BAJA") {
        newEstado = "BAJA";
        newLocationId = null;
        await tx.device.update({
          where: { id: data.deviceId },
          data: { estado: "BAJA", locationId: null },
        });
      } else if (data.tipo === "SALIDA") {
        newLocationId = null;
        await tx.device.update({
          where: { id: data.deviceId },
          data: { locationId: null },
        });
      } else if (data.tipo === "ENTRADA" || data.tipo === "TRASLADO") {
        if (!data.locationId) throw new HttpError(400, "Ubicación requerida para ENTRADA o TRASLADO");
        newLocationId = data.locationId;
        await tx.device.update({
          where: { id: data.deviceId },
          data: { locationId: data.locationId },
        });
      } else if (data.tipo === "DEVOLUCION") {
        const cartaActivaId = device.cartaActivaId;
        if (device.estado === "ASIGNADO") {
          const released = await tx.device.updateMany({
            where: { id: data.deviceId, estado: "ASIGNADO" },
            data: { estado: "DISPONIBLE", cartaActivaId: null },
          });
          if (released.count > 0) {
            newEstado = "DISPONIBLE";
          }
        }
        // Cierra la carta responsiva activa: marca la devolución y libera el
        // candado de préstamo único para que el equipo vuelva a estar asignable.
        if (cartaActivaId) {
          closedCartaId = cartaActivaId;
          await tx.cartaResponsiva.update({
            where: { id: cartaActivaId },
            data: {
              returnDate: new Date(),
              returnedBy: data.userName || data.userId,
              returnCondition: data.condicion || null,
            },
          });
        }
        if (!prestamoId) {
          const active = await tx.inventoryMovement.findFirst({
            where: {
              deviceId: data.deviceId,
              tipo: { in: ["PRESTAMO", "SALIDA"] },
            },
            orderBy: { createdAt: "desc" },
          });
          if (active) {
            prestamoId = active.id;
          }
        }
      }
      // PRESTAMO y DEVOLUCION no modifican la ubicación del dispositivo

      const movement = await tx.inventoryMovement.create({
        data: {
          deviceId: data.deviceId,
          tipo: data.tipo,
          locationId: data.tipo === "SALIDA" || data.tipo === "BAJA" || data.tipo === "PRESTAMO" ? null : data.locationId ?? null,
          notas: data.notas || null,
          userId: data.userId,
          prestamoId,
          prestadoA: data.prestadoA || null,
          fechaRetornoEsperado: data.fechaRetornoEsperado ? new Date(data.fechaRetornoEsperado) : null,
          condicion: data.condicion || null,
          motivoBaja: data.motivoBaja || null,
        },
        include: {
          device: { include: { type: true } },
          location: true,
          user: { select: { id: true, name: true, username: true } },
          prestamo: true,
        },
      });

      // Cierra la carta devuelta con la referencia al movimiento de devolución.
      if (closedCartaId) {
        await tx.cartaResponsiva.update({
          where: { id: closedCartaId },
          data: { inventoryMovementId: movement.id },
        });
      }

      // Toda devolución genera automáticamente un ticket de mantenimiento.
      if (data.tipo === "DEVOLUCION") {
        const actor = await tx.user.findUnique({
          where: { id: data.userId },
          select: { departmentId: true },
        });
        const priority = data.condicion === "ROTO" || data.condicion === "MALO" ? "URGENTE" : data.condicion === "ACEPTABLE" ? "ALTA" : "MEDIA";
        const conditionText = data.condicion ?? "SIN_ESPECIFICAR";
        const autoTicket = await tx.ticket.create({
          data: {
            titulo: `Devolución en ${conditionText}: ${device.controlActivos}`,
            descripcion: [
              `Equipo devuelto en condición ${conditionText}.`,
              data.notas ? `Notas: ${data.notas}` : "",
              device.descripcion ? `Equipo: ${device.descripcion}` : "",
            ]
              .filter(Boolean)
              .join("\n"),
            priority,
            category: "MANTENIMIENTO",
            departmentId: actor?.departmentId ?? null,
            creadoPorId: data.userId,
          },
        });
        await tx.ticketHistory.create({
          data: {
            ticketId: autoTicket.id,
            type: "CREATED",
            detail: `Ticket generado automáticamente por devolución de ${device.controlActivos}`,
            autorId: data.userId,
          },
        });
        autoTicketId = autoTicket.id;
      }

      // Auditoría dentro de la misma transacción: si algo falla después,
      // el log tampoco queda huérfano.
      await this.auditPort.createLog(
        {
          action: `MOVEMENT_${data.tipo}`,
          entityType: "InventoryMovement",
          entityId: movement.id,
          userId: data.userId,
          userName: data.userName || movement.user?.name || "Unknown",
          deviceId: data.deviceId,
          deviceCode: device.controlActivos,
          previousState,
          newState: {
            estado: newEstado,
            locationId: newLocationId,
            tipo: data.tipo,
            condicion: data.condicion,
            motivoBaja: data.motivoBaja,
            notas: data.notas,
          },
          metadata: {
            prestadoA: data.prestadoA,
            fechaRetornoEsperado: data.fechaRetornoEsperado,
          },
        },
        tx as any
      );

      return movement;
    });

    const tipoLabels: Record<string, string> = {
      ENTRADA: "Entrada",
      SALIDA: "Salida",
      TRASLADO: "Traslado",
      BAJA: "Baja",
      PRESTAMO: "Préstamo",
      DEVOLUCION: "Devolución",
    };
    broadcastDashboardEvent({
      scope: "inventory",
      message: `${tipoLabels[data.tipo] ?? data.tipo}: ${movement.device.controlActivos}`,
    }).catch(() => {});
    if (autoTicketId) {
      broadcastTicketEvent({
        type: "CREATED",
        ticketId: autoTicketId,
        data: { auto: true },
      }).catch(() => {});
    }

    return movement;
  }

  async summary() {
    const locations = await this.db.location.findMany({
      orderBy: { createdAt: "asc" },
      include: {
        _count: { select: { devices: true } },
        devices: { include: { type: true } },
      },
    });

    const totalDevices = await this.db.device.count();
    const locatedDevices = await this.db.device.count({ where: { locationId: { not: null } } });
    const unlocatedDevices = await this.db.device.count({ where: { locationId: null } });

    return {
      locations,
      stats: { totalDevices, locatedDevices, unlocatedDevices },
    };
  }
}