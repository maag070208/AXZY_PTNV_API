import { PrismaClient } from "@prisma/client";
import { E2E, E2E_PREFIX } from "./env";

/**
 * Cliente Prisma para verificar en la base lo que la API no expone por HTTP
 * (estado de cada unidad física, `devuelto` de un detalle de préstamo, status
 * de un movimiento) y para limpiar al terminar.
 */
export const db = new PrismaClient();

/** Ids de todo lo que la suite haya creado, resuelto desde el prefijo. */
const alcanceE2E = async () => {
  const tipos = await db.tipoDispositivo.findMany({
    where: { code: { startsWith: E2E_PREFIX } },
    select: { id: true },
  });
  const tipoIds = tipos.map((t) => t.id);
  if (tipoIds.length === 0) {
    return { tipoIds: [], dispositivoIds: [], unidadIds: [], prestamoIds: [], movimientoIds: [] };
  }

  const dispositivos = await db.dispositivo.findMany({
    where: { tipoId: { in: tipoIds } },
    select: { id: true },
  });
  const dispositivoIds = dispositivos.map((d) => d.id);

  const unidades = await db.unidadFisica.findMany({
    where: { dispositivoId: { in: dispositivoIds } },
    select: { id: true },
  });

  const prestamoDetalles = await db.prestamoDetalle.findMany({
    where: { dispositivoId: { in: dispositivoIds } },
    select: { prestamoId: true },
  });

  const movimientoDetalles = await db.movimientoDetalle.findMany({
    where: { dispositivoId: { in: dispositivoIds } },
    select: { movimientoId: true },
  });

  return {
    tipoIds,
    dispositivoIds,
    unidadIds: unidades.map((u) => u.id),
    prestamoIds: [...new Set(prestamoDetalles.map((p) => p.prestamoId))],
    movimientoIds: [...new Set(movimientoDetalles.map((m) => m.movimientoId))],
  };
};

/**
 * Borra los residuos del módulo de control de acceso que dejó una corrida
 * cortada: eventos con `clientEventId` del prefijo E2E y sus audit_logs, más
 * los sitios E2E de prueba (nunca el sitio demo persistente). Los datos reales
 * del cliente no se tocan porque el alcance sale del prefijo `E2E`.
 */
export const limpiarAccessE2E = async (): Promise<{ eventos: number; sitios: number }> => {
  const eventos = await db.accessEvent.findMany({
    where: { clientEventId: { startsWith: `${E2E_PREFIX}-` } },
    select: { id: true },
  });
  const eventoIds = eventos.map((e) => e.id);
  if (eventoIds.length > 0) {
    await db.auditLog.deleteMany({
      where: { entityType: "AccessEvent", entityId: { in: eventoIds } },
    });
    await db.accessEvent.deleteMany({ where: { id: { in: eventoIds } } });
  }

  const sitios = await db.site.deleteMany({
    where: { code: { startsWith: E2E_PREFIX }, NOT: { code: E2E.demoSite.code } },
  });

  return { eventos: eventoIds.length, sitios: sitios.count };
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
export const limpiarTicketsE2E = async (): Promise<{ tickets: number; categorias: number }> => {
  const tickets = await db.ticket.findMany({
    where: { titulo: { startsWith: E2E_PREFIX } },
    select: { id: true },
  });
  const ticketIds = tickets.map((t) => t.id);

  // Sin tickets E2E: sólo puede quedar alguna categoría huérfana de una corrida
  // que se cortó entre el borrado de tickets y el de categorías.
  if (ticketIds.length === 0) {
    const categorias = await db.ticketCategory.deleteMany({
      where: { nombre: { startsWith: E2E_PREFIX }, tickets: { none: {} } },
    });
    return { tickets: 0, categorias: categorias.count };
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

  const categorias = await db.ticketCategory.deleteMany({
    where: { nombre: { startsWith: E2E_PREFIX }, tickets: { none: {} } },
  });

  return { tickets: ticketIds.length, categorias: categorias.count };
};

/**
 * Borra todo lo que produjo la suite, en orden seguro de llaves foráneas:
 * devoluciones → préstamos → movimientos → unidades → dispositivos → tipos.
 * Los datos reales del cliente quedan intactos porque el alcance sale del
 * prefijo `E2E` en el tipo de dispositivo.
 */
export const limpiarDatosE2E = async (): Promise<{
  tipos: number;
  dispositivos: number;
  unidades: number;
  tickets: number;
  categorias: number;
}> => {
  await limpiarAccessE2E();
  // Los tickets van antes del early-return de inventario: una corrida de la
  // suite de tickets no crea tipos de dispositivo, así que si se limpiaran
  // después, nunca correrían.
  const tickets = await limpiarTicketsE2E();

  const { tipoIds, dispositivoIds, unidadIds, prestamoIds, movimientoIds } = await alcanceE2E();
  if (tipoIds.length === 0) return { tipos: 0, dispositivos: 0, unidades: 0, ...tickets };

  // Devolucion → DevolucionDetalle → DevolucionDetalleUnidad van en cascada,
  // pero DevolucionDetalle apunta a PrestamoDetalle sin cascada: primero éstas.
  await db.devolucion.deleteMany({ where: { prestamoId: { in: prestamoIds } } });
  // Prestamo.movimientoId apunta a Movimiento: los préstamos antes que los movimientos.
  await db.prestamo.deleteMany({ where: { id: { in: prestamoIds } } });
  await db.materialOutput.deleteMany({ where: { unidadFisicaId: { in: unidadIds } } });
  await db.movimiento.deleteMany({ where: { id: { in: movimientoIds } } });
  await db.auditLog.deleteMany({ where: { entityId: { in: movimientoIds } } });
  await db.unidadFisica.deleteMany({ where: { dispositivoId: { in: dispositivoIds } } });
  await db.dispositivo.deleteMany({ where: { id: { in: dispositivoIds } } });
  await db.tipoDispositivo.deleteMany({ where: { id: { in: tipoIds } } });

  return {
    tipos: tipoIds.length,
    dispositivos: dispositivoIds.length,
    unidades: unidadIds.length,
    ...tickets,
  };
};

/** Conteo de unidades por estado leído directo de la base. */
export const estadosEnBase = async (dispositivoId: string): Promise<Record<string, number>> => {
  const filas = await db.unidadFisica.groupBy({
    by: ["estado"],
    where: { dispositivoId },
    _count: { _all: true },
  });
  return Object.fromEntries(filas.map((f) => [f.estado, f._count._all]));
};
