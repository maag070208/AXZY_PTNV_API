import { prismaClient } from "@core/config/database";
import type { DashboardSummary } from "../models/dto/dashboard.dto";

type Activity = DashboardSummary["recentActivity"][number];

const TIPO_LABELS: Record<string, string> = {
  ENTRADA: "Entrada",
  PRESTAMO: "Préstamo",
  DEVOLUCION: "Devolución",
  BAJA: "Baja",
  TRASPASO: "Traspaso",
  AJUSTE_ENTRADA: "Ajuste entrada",
  AJUSTE_SALIDA: "Ajuste salida",
  MANTENIMIENTO_ENTRADA: "A mantenimiento",
  MANTENIMIENTO_SALIDA: "Sale de mantenimiento",
  REVERSION: "Reversión",
};

export class DashboardService {
  constructor(private readonly db = prismaClient) {}

  async summary(): Promise<DashboardSummary> {
    const [unidades, ticketsTotal, ticketsAbierto, ticketsEnSeguimiento, ticketsCerrado, prestamos, prestamosActivos, salidasTotal, salidasDanadas, departamentos, empleados, recentMovements, recentTickets, recentPrestamos, recentSalidas, asignaciones, viejos] =
      await Promise.all([
        this.db.unidadFisica.findMany({ select: { estado: true } }),
        this.db.ticket.count({ where: { deletedAt: null } }),
        this.db.ticket.count({ where: { deletedAt: null, status: "ABIERTO" } }),
        this.db.ticket.count({ where: { deletedAt: null, status: "EN_SEGUIMIENTO" } }),
        this.db.ticket.count({ where: { deletedAt: null, status: "CERRADO" } }),
        this.db.prestamo.count(),
        this.db.prestamo.count({ where: { status: { in: ["ACTIVO", "PARCIAL"] } } }),
        this.db.materialOutput.count(),
        this.db.materialOutput.count({ where: { motivo: "DANADO" } }),
        this.db.department.count({ where: { active: true } }),
        this.db.user.count({ where: { role: "EMPLEADO", active: true } }),
        this.db.movimiento.findMany({
          orderBy: { fecha: "desc" },
          take: 8,
          include: { detalles: { include: { dispositivo: true } } },
        }),
        this.db.ticket.findMany({
          where: { deletedAt: null },
          orderBy: { creadoEn: "desc" },
          take: 8,
          select: { id: true, titulo: true, creadoEn: true },
        }),
        this.db.prestamo.findMany({
          orderBy: { fecha: "desc" },
          take: 8,
          select: { id: true, consecutivo: true, fecha: true },
        }),
        this.db.materialOutput.findMany({
          orderBy: { fecha: "desc" },
          take: 8,
          select: { id: true, descripcion: true, fecha: true },
        }),
        this.db.ticketAssignment.findMany({
          select: {
            userId: true,
            status: true,
            createdAt: true,
            updatedAt: true,
            user: { select: { id: true, name: true, puesto: true } },
          },
        }),
        this.db.ticket.findMany({
          where: { deletedAt: null, status: { not: "CERRADO" } },
          orderBy: { creadoEn: "asc" },
          take: 6,
          select: {
            id: true,
            titulo: true,
            priority: true,
            creadoEn: true,
            asignadoA: { select: { name: true } },
          },
        }),
      ]);

    let disponible = 0;
    let prestado = 0;
    let baja = 0;
    for (const u of unidades) {
      if (u.estado === "DISPONIBLE") disponible++;
      else if (u.estado === "PRESTADO") prestado++;
      else if (u.estado === "BAJA") baja++;
    }

    const activity: Activity[] = [
      ...recentMovements.map((m): Activity => ({
        id: `mov-${m.id}`,
        scope: "inventory",
        message: `${TIPO_LABELS[m.tipo] ?? m.tipo}: ${m.detalles[0]?.dispositivo?.nombre ?? "inventario"}`,
        at: m.fecha.toISOString(),
        targetId: m.id,
        deviceId: m.detalles[0]?.dispositivoId ?? null,
      })),
      ...recentTickets.map((t): Activity => ({
        id: `tkt-${t.id}`,
        scope: "tickets",
        message: `Ticket: ${t.titulo}`,
        at: t.creadoEn.toISOString(),
        targetId: t.id,
        deviceId: null,
      })),
      ...recentPrestamos.map((c): Activity => ({
        id: `crt-${c.id}`,
        scope: "cartas",
        message: `Préstamo (carta) ${c.consecutivo}`,
        at: c.fecha.toISOString(),
        targetId: c.id,
        deviceId: null,
      })),
      ...recentSalidas.map((s): Activity => ({
        id: `sal-${s.id}`,
        scope: "salidas",
        message: `Salida: ${s.descripcion}`,
        at: s.fecha.toISOString(),
        targetId: s.id,
        deviceId: null,
      })),
    ]
      .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
      .slice(0, 15);

const DAY_MS = 86_400_000;
    const porUsuario = new Map<string, { user: { id: string; name: string; puesto: string | null }; resueltas: number; pendientes: number; sumMs: number; n: number }>();
    let tareasResueltas = 0;
    let tareasPendientes = 0;
    let sumResolucionMs = 0;
    let nResoluciones = 0;
    for (const a of asignaciones) {
      const entry =
        porUsuario.get(a.userId) ??
        { user: { id: a.user.id, name: a.user.name, puesto: a.user.puesto }, resueltas: 0, pendientes: 0, sumMs: 0, n: 0 };
      if (a.status === "COMPLETADA") {
        entry.resueltas += 1;
        const ms = a.updatedAt.getTime() - a.createdAt.getTime();
        if (ms >= 0) {
          entry.sumMs += ms;
          entry.n += 1;
          sumResolucionMs += ms;
          nResoluciones += 1;
        }
      } else {
        entry.pendientes += 1;
      }
      porUsuario.set(a.userId, entry);
    }
    tareasResueltas = [...porUsuario.values()].reduce((s, e) => s + e.resueltas, 0);
    tareasPendientes = [...porUsuario.values()].reduce((s, e) => s + e.pendientes, 0);

    const ticketEficiencia = [...porUsuario.values()]
      .map((e) => ({
        user: e.user,
        resueltas: e.resueltas,
        pendientes: e.pendientes,
        avgDias: e.n > 0 ? Math.round((e.sumMs / e.n / DAY_MS) * 10) / 10 : null,
      }))
      .sort((a, b) => b.resueltas - a.resueltas || (a.user.name ?? "").localeCompare(b.user.name ?? ""));

    const ahora = Date.now();
    const ticketsUrgentes = viejos.map((t) => ({
      id: t.id,
      titulo: t.titulo,
      prioridad: t.priority,
      creadoEn: t.creadoEn.toISOString(),
      diasEnEspera: Math.max(1, Math.floor((ahora - t.creadoEn.getTime()) / DAY_MS)),
      asignado: t.asignadoA?.name ?? null,
    }));

    return {
      devices: {
        total: unidades.length,
        disponible,
        asignado: prestado,
        baja,
      },
      tickets: {
        total: ticketsTotal,
        abierto: ticketsAbierto,
        enSeguimiento: ticketsEnSeguimiento,
        cerrado: ticketsCerrado,
      },
      cartas: { total: prestamos, activas: prestamosActivos },
      salidas: { total: salidasTotal, danadas: salidasDanadas },
      departamentos,
      empleados,
      ticketMetricas: {
        tareasResueltas,
        tareasPendientes,
        avgResolucionDias: nResoluciones > 0 ? Math.round((sumResolucionMs / nResoluciones / DAY_MS) * 10) / 10 : null,
      },
      ticketEficiencia,
      ticketsUrgentes,
      recentActivity: activity,
    };
  }
}