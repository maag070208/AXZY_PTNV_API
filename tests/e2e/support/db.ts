import { PrismaClient } from "@prisma/client";
import { E2E, E2E_PREFIX } from "./env";

/**
 * Cliente Prisma para verificar en la base lo que la API no expone por HTTP
 * (estado de cada unidad física, `devuelto` de un detalle de préstamo, status
 * de un movimiento) y para limpiar al terminar.
 */
export const db = new PrismaClient();

/** Ids de todo lo que la suite haya creado, resuelto desde el prefijo. */
const scopeE2E = async () => {
  const types = await db.deviceType.findMany({
    where: { code: { startsWith: E2E_PREFIX } },
    select: { id: true },
  });
  const typeIds = types.map((t) => t.id);
  if (typeIds.length === 0) {
    return { typeIds: [], deviceIds: [], unitIds: [], loanIds: [], movementIds: [] };
  }

  const devices = await db.device.findMany({
    where: { typeId: { in: typeIds } },
    select: { id: true },
  });
  const deviceIds = devices.map((d) => d.id);

  const units = await db.deviceUnit.findMany({
    where: { deviceId: { in: deviceIds } },
    select: { id: true },
  });

  const loanItems = await db.loanItem.findMany({
    where: { deviceId: { in: deviceIds } },
    select: { loanId: true },
  });

  const movementItems = await db.movementItem.findMany({
    where: { deviceId: { in: deviceIds } },
    select: { movementId: true },
  });

  return {
    typeIds,
    deviceIds,
    unitIds: units.map((u) => u.id),
    loanIds: [...new Set(loanItems.map((p) => p.loanId))],
    movementIds: [...new Set(movementItems.map((m) => m.movementId))],
  };
};

/**
 * Borra los residuos del módulo de control de acceso que dejó una corrida
 * cortada: eventos con `clientEventId` del prefijo E2E y sus audit_logs, más
 * los sitios E2E de prueba (nunca el sitio demo persistente). Los datos reales
 * del cliente no se tocan porque el alcance sale del prefijo `E2E`.
 */
export const clearAccessE2E = async (): Promise<{ events: number; sites: number }> => {
  const events = await db.accessEvent.findMany({
    where: { clientEventId: { startsWith: `${E2E_PREFIX}-` } },
    select: { id: true },
  });
  const eventIds = events.map((e) => e.id);
  if (eventIds.length > 0) {
    await db.auditLog.deleteMany({
      where: { entityType: "AccessEvent", entityId: { in: eventIds } },
    });
    await db.accessEvent.deleteMany({ where: { id: { in: eventIds } } });
  }

  const sites = await db.site.deleteMany({
    where: { code: { startsWith: E2E_PREFIX }, NOT: { code: E2E.demoSite.code } },
  });

  return { events: eventIds.length, sites: sites.count };
};

/**
 * Borra los residuos del módulo de tickets que dejó una corrida cortada:
 * tickets con título `E2E …`, sus asignaciones/comentarios/historial (en
 * cascada), las notificaciones ligadas y los correos de la cola, más las
 * categorías `E2E …` que ya no tengan tickets. Los datos reales del cliente no
 * se tocan porque el alcance sale del prefijo `E2E`.
 *
 * Orden seguro de llaves foráneas: notifications/email_logs → tickets (cascada)
 * → categorías. `email_logs` se resuelve por `entityId` (el ticket/la tarea) y,
 * como respaldo, por el asunto `E2E ` para los tickets ya borrados físicamente.
 */
export const clearTicketsE2E = async (): Promise<{ tickets: number; categories: number }> => {
  const tickets = await db.ticket.findMany({
    where: { title: { startsWith: E2E_PREFIX } },
    select: { id: true },
  });
  const ticketIds = tickets.map((t) => t.id);

  // Sin tickets E2E: sólo puede quedar alguna categoría huérfana de una corrida
  // que se cortó entre el borrado de tickets y el de categorías.
  if (ticketIds.length === 0) {
    const categories = await db.ticketCategory.deleteMany({
      where: { name: { startsWith: E2E_PREFIX }, tickets: { none: {} } },
    });
    return { tickets: 0, categories: categories.count };
  }

  // Las asignaciones se resuelven ANTES de borrar los tickets (el delete del
  // ticket las cascadea y ya no habría cómo referenciarlas en email_logs).
  const assignments = await db.ticketAssignment.findMany({
    where: { ticketId: { in: ticketIds } },
    select: { id: true },
  });
  const assignmentIds = assignments.map((a) => a.id);

  await db.notification.deleteMany({
    where: {
      OR: [
        { ticketId: { in: ticketIds } },
        // Respaldo para tickets ya borrados físicamente en una corrida previa:
        // la notificación conserva el título del ticket (`… "E2E …"`).
        { ticketId: { not: null }, title: { contains: `${E2E_PREFIX} ` } },
      ],
    },
  });
  await db.emailLog.deleteMany({
    where: {
      OR: [
        { entityType: "Ticket", entityId: { in: ticketIds } },
        { entityType: "TicketAssignment", entityId: { in: assignmentIds } },
        { action: { startsWith: "ticket." }, subject: { contains: `${E2E_PREFIX} ` } },
      ],
    },
  });

  // Cascadea TicketAssignment / TicketComment / TicketHistory / TicketAttachment.
  await db.ticket.deleteMany({ where: { id: { in: ticketIds } } });

  const categories = await db.ticketCategory.deleteMany({
    where: { name: { startsWith: E2E_PREFIX }, tickets: { none: {} } },
  });

  return { tickets: ticketIds.length, categories: categories.count };
};

/**
 * Borra todo lo que produjo la suite, en orden seguro de llaves foráneas:
 * devoluciones → préstamos → movimientos → unidades → dispositivos → tipos.
 * Los datos reales del cliente quedan intactos porque el alcance sale del
 * prefijo `E2E` en el tipo de dispositivo.
 */
export const clearDataE2E = async (): Promise<{
  types: number;
  devices: number;
  units: number;
  tickets: number;
  categories: number;
}> => {
  await clearAccessE2E();
  // Los tickets van antes del early-return de inventario: una corrida de la
  // suite de tickets no crea tipos de dispositivo, así que si se limpiaran
  // después, nunca correrían.
  const tickets = await clearTicketsE2E();

  const { typeIds, deviceIds, unitIds, loanIds, movementIds } = await scopeE2E();
  if (typeIds.length === 0) return { types: 0, devices: 0, units: 0, ...tickets };

  // Devolucion → DevolucionDetalle → DevolucionDetalleUnidad van en cascada,
  // pero DevolucionDetalle apunta a PrestamoDetalle sin cascada: primero éstas.
  await db.loanReturn.deleteMany({ where: { loanId: { in: loanIds } } });
  // Prestamo.movimientoId apunta a Movimiento: los préstamos antes que los movimientos.
  await db.loan.deleteMany({ where: { id: { in: loanIds } } });
  await db.materialOutput.deleteMany({ where: { deviceUnitId: { in: unitIds } } });
  await db.movement.deleteMany({ where: { id: { in: movementIds } } });
  await db.auditLog.deleteMany({ where: { entityId: { in: movementIds } } });
  await db.deviceUnit.deleteMany({ where: { deviceId: { in: deviceIds } } });
  await db.device.deleteMany({ where: { id: { in: deviceIds } } });
  await db.deviceType.deleteMany({ where: { id: { in: typeIds } } });

  return {
    types: typeIds.length,
    devices: deviceIds.length,
    units: unitIds.length,
    ...tickets,
  };
};

/** Conteo de unidades por estado leído directo de la base. */
export const statusesInDb = async (deviceId: string): Promise<Record<string, number>> => {
  const rows = await db.deviceUnit.groupBy({
    by: ["status"],
    where: { deviceId },
    _count: { _all: true },
  });
  return Object.fromEntries(rows.map((f) => [f.status, f._count._all]));
};
