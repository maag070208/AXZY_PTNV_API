import { prismaClient } from "@core/config/database";
import type { DashboardSummary } from "../models/dto/dashboard.dto";

type Activity = DashboardSummary["recentActivity"][number];

const TIPO_LABELS: Record<string, string> = {
  ENTRADA: "Entrada",
  SALIDA: "Salida",
  TRASLADO: "Traslado",
  BAJA: "Baja",
  PRESTAMO: "Préstamo",
  DEVOLUCION: "Devolución",
};

export class DashboardService {
  constructor(private readonly db = prismaClient) {}

  async summary(): Promise<DashboardSummary> {
    const [
      devicesTotal,
      devicesDisponible,
      devicesAsignado,
      devicesBaja,
      ticketsTotal,
      ticketsAbierto,
      ticketsEnSeguimiento,
      ticketsCerrado,
      cartasTotal,
      cartasActivas,
      salidasTotal,
      salidasDanadas,
      departamentos,
      empleados,
      recentMovements,
      recentTickets,
      recentCartas,
      recentSalidas,
    ] = await Promise.all([
      this.db.device.count(),
      this.db.device.count({ where: { estado: "DISPONIBLE" } }),
      this.db.device.count({ where: { estado: "ASIGNADO" } }),
      this.db.device.count({ where: { estado: "BAJA" } }),
      this.db.ticket.count({ where: { deletedAt: null } }),
      this.db.ticket.count({ where: { deletedAt: null, status: "ABIERTO" } }),
      this.db.ticket.count({ where: { deletedAt: null, status: "EN_SEGUIMIENTO" } }),
      this.db.ticket.count({ where: { deletedAt: null, status: "CERRADO" } }),
      this.db.cartaResponsiva.count(),
      this.db.cartaResponsiva.count({ where: { returnDate: null } }),
      this.db.materialOutput.count(),
      this.db.materialOutput.count({ where: { motivo: "DANADO" } }),
      this.db.department.count({ where: { active: true } }),
      this.db.user.count({ where: { role: "EMPLEADO", active: true } }),
      this.db.inventoryMovement.findMany({
        orderBy: { createdAt: "desc" },
        take: 8,
        include: { device: { select: { controlActivos: true } } },
      }),
      this.db.ticket.findMany({
        where: { deletedAt: null },
        orderBy: { creadoEn: "desc" },
        take: 8,
        select: { id: true, titulo: true, creadoEn: true },
      }),
      this.db.cartaResponsiva.findMany({
        orderBy: { fecha: "desc" },
        take: 8,
        select: { id: true, consecutive: true, fecha: true },
      }),
      this.db.materialOutput.findMany({
        orderBy: { fecha: "desc" },
        take: 8,
        select: { id: true, descripcion: true, fecha: true },
      }),
    ]);

    const activity: Activity[] = [
      ...recentMovements.map((m): Activity => ({
        id: `mov-${m.id}`,
        scope: "inventory",
        message: `${TIPO_LABELS[m.tipo] ?? m.tipo}: ${m.device.controlActivos}`,
        at: m.createdAt.toISOString(),
      })),
      ...recentTickets.map((t): Activity => ({
        id: `tkt-${t.id}`,
        scope: "tickets",
        message: `Ticket: ${t.titulo}`,
        at: t.creadoEn.toISOString(),
      })),
      ...recentCartas.map((c): Activity => ({
        id: `crt-${c.id}`,
        scope: "cartas",
        message: `Carta responsiva ${c.consecutive}`,
        at: c.fecha.toISOString(),
      })),
      ...recentSalidas.map((s): Activity => ({
        id: `sal-${s.id}`,
        scope: "salidas",
        message: `Salida: ${s.descripcion}`,
        at: s.fecha.toISOString(),
      })),
    ]
      .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
      .slice(0, 15);

    return {
      devices: {
        total: devicesTotal,
        disponible: devicesDisponible,
        asignado: devicesAsignado,
        baja: devicesBaja,
      },
      tickets: {
        total: ticketsTotal,
        abierto: ticketsAbierto,
        enSeguimiento: ticketsEnSeguimiento,
        cerrado: ticketsCerrado,
      },
      cartas: { total: cartasTotal, activas: cartasActivas },
      salidas: { total: salidasTotal, danadas: salidasDanadas },
      departamentos,
      empleados,
      recentActivity: activity,
    };
  }
}
