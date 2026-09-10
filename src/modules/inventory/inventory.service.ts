import { prismaClient } from "@core/config/database";
import { HttpError } from "@core/middlewares/error.middleware";
import { formatLocation } from "../locations/location.service";
import { createAuditLog } from "../audit/audit.service";

export const listMovements = async (params: {
  deviceId?: string;
  locationId?: string;
  start?: string;
  end?: string;
}) => {
  const where: any = {};

  if (params.deviceId) where.deviceId = params.deviceId;
  if (params.locationId) where.locationId = params.locationId;
  if (params.start || params.end) {
    where.createdAt = {};
    if (params.start) where.createdAt.gte = new Date(params.start);
    if (params.end) where.createdAt.lte = new Date(params.end);
  }

  return prismaClient.inventoryMovement.findMany({
    where,
    orderBy: { createdAt: "desc" },
    include: {
      device: {
        include: { type: true },
      },
      location: true,
      user: { select: { id: true, name: true, username: true } },
    },
  });
};

export const getKardexByDevice = async (deviceId: string) => {
  const device = await prismaClient.device.findUnique({
    where: { id: deviceId },
    include: { type: true },
  });
  if (!device) throw new HttpError(404, "Dispositivo no encontrado");

  const movements = await prismaClient.inventoryMovement.findMany({
    where: { deviceId },
    orderBy: { createdAt: "asc" },
    include: {
      location: true,
      user: { select: { id: true, name: true, username: true } },
    },
  });

  return { device, movements };
};

export const registerMovement = async (data: {
  deviceId: string;
  tipo: "ENTRADA" | "SALIDA" | "TRASLADO" | "BAJA" | "PRESTAMO" | "DEVOLUCION";
  locationId?: string;
  notas?: string;
  userId: string;
  userName?: string;
  prestamoId?: string;
  prestadoA?: string;
  fechaRetornoEsperado?: string;
  condicion?: "BUENO" | "ACEPTABLE" | "MALO" | "ROTO";
  motivoBaja?: string;
  cartaId?: string;
}) => {
  // Toda la operación (lectura, validación, actualización del dispositivo,
  // creación del movimiento y su auditoría) queda dentro de una sola
  // transacción: o se aplica todo, o no se aplica nada. Esto evita que un
  // fallo a mitad de camino deje el estado del dispositivo desincronizado
  // de su historial de movimientos.
  return prismaClient.$transaction(async (tx) => {
    const device = await tx.device.findUnique({
      where: { id: data.deviceId },
      include: { type: true, location: true },
    });
    if (!device) throw new HttpError(404, "Dispositivo no encontrado");

    // Un dispositivo dado de baja ya no admite más movimientos (salvo, por
    // supuesto, otro BAJA idempotente).
    if (device.estado === "BAJA" && data.tipo !== "BAJA") {
      throw new HttpError(
        409,
        "El dispositivo ya fue dado de baja y no admite más movimientos de inventario"
      );
    }

    const previousState = {
      estado: device.estado,
      locationId: device.locationId,
      location: device.location ? {
        id: device.location.id,
        lugar: device.location.lugar,
        subLugar: device.location.subLugar,
        numero: device.location.numero,
      } : null,
    };

    let newEstado = device.estado;
    let newLocationId = device.locationId;
    let prestamoId = data.prestamoId || null;

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
      if (device.estado === "ASIGNADO") {
        // Actualización condicionada al estado leído: si otro proceso ya
        // liberó el dispositivo entre la lectura y este punto, la condición
        // simplemente no matchea y no sobreescribimos nada por encima.
        const released = await tx.device.updateMany({
          where: { id: data.deviceId, estado: "ASIGNADO" },
          data: { estado: "DISPONIBLE" },
        });
        if (released.count > 0) {
          newEstado = "DISPONIBLE";
        }
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

    // Auditoría dentro de la misma transacción: si algo falla después, el
    // log tampoco queda huérfano.
    await createAuditLog(
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
      tx
    );

    return movement;
  });
};

export const getInventorySummary = async () => {
  const locations = await prismaClient.location.findMany({
    orderBy: { createdAt: "asc" },
    include: {
      _count: { select: { devices: true } },
      devices: {
        include: { type: true },
      },
    },
  });

  const totalDevices = await prismaClient.device.count();
  const locatedDevices = await prismaClient.device.count({ where: { locationId: { not: null } } });
  const unlocatedDevices = await prismaClient.device.count({ where: { locationId: null } });

  return {
    locations,
    stats: {
      totalDevices,
      locatedDevices,
      unlocatedDevices,
    },
  };
};
