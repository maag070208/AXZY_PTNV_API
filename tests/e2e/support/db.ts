import { PrismaClient } from "@prisma/client";
import { E2E_PREFIX } from "./env";

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
 * Borra todo lo que produjo la suite, en orden seguro de llaves foráneas:
 * devoluciones → préstamos → movimientos → unidades → dispositivos → tipos.
 * Los datos reales del cliente quedan intactos porque el alcance sale del
 * prefijo `E2E` en el tipo de dispositivo.
 */
export const limpiarDatosE2E = async (): Promise<{ tipos: number; dispositivos: number; unidades: number }> => {
  const { tipoIds, dispositivoIds, unidadIds, prestamoIds, movimientoIds } = await alcanceE2E();
  if (tipoIds.length === 0) return { tipos: 0, dispositivos: 0, unidades: 0 };

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

  return { tipos: tipoIds.length, dispositivos: dispositivoIds.length, unidades: unidadIds.length };
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
