import { prismaClient } from "@core/config/database";
import type {
  Asignacion,
  AsignadoRow,
  DeviceReportRow,
} from "../models/entity/report.entity";

const msPerDay = 1000 * 60 * 60 * 24;

export class AssignmentService {
  constructor(private readonly db = prismaClient) {}

  // Para un conjunto de unidades físicas, resuelve quién las tiene prestadas
  // actualmente (préstamo ACTIVO/PARCIAL vigente).
  async resolveAssignments(unidadFisicaIds: string[]): Promise<Map<string, Asignacion>> {
    const result = new Map<string, Asignacion>();
    if (unidadFisicaIds.length === 0) return result;

    const units = await this.db.prestamoDetalleUnidad.findMany({
      where: {
        unidadFisicaId: { in: unidadFisicaIds },
        devuelto: false,
        prestamoDetalle: {
          prestamo: { status: { in: ["ACTIVO", "PARCIAL"] } },
        },
      },
      include: {
        prestamoDetalle: {
          include: {
            prestamo: {
              include: {
                responsable: true,
                departamento: { select: { name: true } },
              },
            },
          },
        },
      },
    });

    for (const u of units) {
      if (result.has(u.unidadFisicaId)) continue;
      const p = u.prestamoDetalle.prestamo;
      result.set(u.unidadFisicaId, {
        responsable: p.responsable?.name ?? "—",
        numeroEmpleado: p.responsable?.numeroEmpleado ?? null,
        departamento: p.departamento?.name ?? null,
        fecha: p.fecha,
        diasAsignado: p.fecha ? Math.floor((Date.now() - p.fecha.getTime()) / msPerDay) : null,
        origen: "CARTA",
        folio: p.consecutivo,
      });
    }

    return result;
  }

  async getAsignadosReport(): Promise<AsignadoRow[]> {
    const units = await this.db.unidadFisica.findMany({
      where: { estado: "PRESTADO" },
      include: { dispositivo: { include: { tipo: true } } },
      orderBy: { activoFijo: "asc" },
    });

    const assignments = await this.resolveAssignments(units.map((u) => u.id));

    return units.map((u) => {
      const a = assignments.get(u.id);
      return {
        deviceId: u.id,
        controlActivos: u.activoFijo,
        descripcion: u.dispositivo.nombre,
        marca: u.dispositivo.marca,
        modelo: u.dispositivo.modelo,
        tipo: u.dispositivo.tipo?.name ?? "",
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
    const units = await this.db.unidadFisica.findMany({
      orderBy: { activoFijo: "asc" },
      include: {
        dispositivo: { include: { tipo: true } },
        departamento: { select: { id: true, name: true } },
      },
    });

    const prestadas = units.filter((u) => u.estado === "PRESTADO").map((u) => u.id);
    const assignments = await this.resolveAssignments(prestadas);

    return units.map((u) => {
      const asignacion = u.estado === "PRESTADO" ? assignments.get(u.id) ?? null : null;
      return {
        deviceId: u.id,
        controlActivos: u.activoFijo,
        descripcion: u.dispositivo.nombre,
        marca: u.dispositivo.marca,
        modelo: u.dispositivo.modelo,
        tipo: u.dispositivo.tipo?.name ?? "",
        numeroSerie: u.numeroSerie,
        nombreEquipo: u.nombreEquipo,
        ip: u.ip,
        macAddress: u.macAddress,
        area: u.area,
        departmentName: u.departamento?.name ?? null,
        // La web (y el resto del reporte) habla en términos de "ASIGNADO";
        // el inventario guarda la unidad como PRESTADO. Se normaliza aquí para
        // no filtrar el estado físico crudo al reporte (mismo criterio que
        // report.service.toRows).
        estado: u.estado === "PRESTADO" ? "ASIGNADO" : u.estado,
        loteId: null,
        cantidad: 1,
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