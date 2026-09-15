import { prismaClient } from "@core/config/database";
import type {
  Asignacion,
  AsignadoRow,
  DeviceReportRow,
} from "../models/entity/report.entity";

const msPerDay = 1000 * 60 * 60 * 24;

export class AssignmentService {
  constructor(private readonly db = prismaClient) {}

  // Resuelve, para un conjunto de dispositivos, quién los tiene asignados
  // actualmente: carta responsiva activa (sin devolución) o, si no hay carta,
  // el último movimiento de salida/préstamo. Antes esto se resolvía con 1-2
  // queries POR DISPOSITIVO dentro de un for (N+1 clásico); ahora son como
  // mucho 2 queries en total sin importar cuántos dispositivos se pidan.
  async resolveAssignments(deviceIds: string[]): Promise<Map<string, Asignacion>> {
    const result = new Map<string, Asignacion>();
    if (deviceIds.length === 0) return result;

    const cartaItems = await this.db.cartaItem.findMany({
      where: { deviceId: { in: deviceIds }, carta: { returnDate: null } },
      include: { carta: { include: { responsable: true } } },
      orderBy: { carta: { fecha: "desc" } },
    });

    for (const item of cartaItems) {
      // Ya viene ordenado por fecha desc, así que la primera aparición por
      // deviceId es la más reciente — igual semántica que el findFirst original.
      if (!item.deviceId || result.has(item.deviceId)) continue;
      const c = item.carta;
      result.set(item.deviceId, {
        responsable: c.responsable?.name ?? c.numeroEmpleado ?? "—",
        numeroEmpleado: c.numeroEmpleado,
        departamento: c.departamento,
        fecha: c.fecha,
        diasAsignado: c.fecha ? Math.floor((Date.now() - c.fecha.getTime()) / msPerDay) : null,
        origen: "CARTA",
        folio: c.consecutive,
      });
    }

    const withoutCarta = deviceIds.filter((id) => !result.has(id));
    if (withoutCarta.length > 0) {
      const movements = await this.db.inventoryMovement.findMany({
        where: { deviceId: { in: withoutCarta }, tipo: { in: ["SALIDA", "PRESTAMO"] } },
        orderBy: { createdAt: "desc" },
      });
      for (const m of movements) {
        if (result.has(m.deviceId)) continue;
        result.set(m.deviceId, {
          responsable: m.prestadoA ?? "—",
          numeroEmpleado: null,
          departamento: null,
          fecha: m.createdAt,
          diasAsignado: Math.floor((Date.now() - m.createdAt.getTime()) / msPerDay),
          origen: "MOVIMIENTO",
          folio: null,
        });
      }
    }

    return result;
  }

  async getAsignadosReport(): Promise<AsignadoRow[]> {
    const devices = await this.db.device.findMany({
      where: { estado: "ASIGNADO" },
      include: { type: true },
      orderBy: { controlActivos: "asc" },
    });

    const assignments = await this.resolveAssignments(devices.map((d) => d.id));

    return devices.map((d) => {
      const a = assignments.get(d.id);
      return {
        deviceId: d.id,
        controlActivos: d.controlActivos,
        descripcion: d.descripcion,
        marca: d.marca,
        modelo: d.modelo,
        tipo: d.type?.name ?? "",
        responsable: a?.responsable ?? "—",
        numeroEmpleado: a?.numeroEmpleado ?? null,
        departamento: a?.departamento ?? null,
        fecha: a?.fecha ?? null,
        diasAsignado: a?.diasAsignado ?? null,
        origen: a?.origen ?? "DESCONOCIDO",
        folio: a?.folio ?? null,
      };
    });
  }

  async getDevicesReport(): Promise<DeviceReportRow[]> {
    const devices = await this.db.device.findMany({
      orderBy: { controlActivos: "asc" },
      include: { type: true, department: { select: { id: true, name: true } } },
    });

    const loteIds = Array.from(
      new Set(devices.map((d) => d.loteId).filter((v): v is string => !!v))
    );
    let loteSizes: Record<string, number> = {};
    if (loteIds.length > 0) {
      const grouped = await this.db.device.groupBy({
        by: ["loteId"],
        where: { loteId: { in: loteIds } },
        _count: { _all: true },
      });
      loteSizes = Object.fromEntries(
        grouped.map((g) => [g.loteId as string, g._count._all as number])
      );
    }

    const assignedIds = devices.filter((d) => d.estado === "ASIGNADO").map((d) => d.id);
    const assignments = await this.resolveAssignments(assignedIds);

    return devices.map((d) => {
      const asignacion = d.estado === "ASIGNADO" ? assignments.get(d.id) ?? null : null;

      return {
        deviceId: d.id,
        controlActivos: d.controlActivos,
        descripcion: d.descripcion,
        marca: d.marca,
        modelo: d.modelo,
        tipo: d.type?.name ?? "",
        numeroSerie: d.numeroSerie,
        nombreEquipo: d.nombreEquipo,
        ip: d.ip,
        macAddress: d.macAddress,
        area: d.area,
        departmentName: d.department?.name ?? null,
        estado: d.estado,
        loteId: d.loteId,
        cantidad: d.loteId ? loteSizes[d.loteId] ?? 1 : 1,
        responsable: asignacion?.responsable ?? null,
        numeroEmpleado: asignacion?.numeroEmpleado ?? null,
        departamento: asignacion?.departamento ?? null,
        fecha: asignacion?.fecha ?? null,
        diasAsignado: asignacion?.diasAsignado ?? null,
        origen: asignacion?.origen ?? null,
        folio: asignacion?.folio ?? null,
      };
    });
  }
}