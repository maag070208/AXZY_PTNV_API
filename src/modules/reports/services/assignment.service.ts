import { prismaClient } from "@core/config/database";
import type {
  Assignment,
  AssignedDeviceRow,
  DeviceReportRow,
} from "../models/entity/report.entity";

const msPerDay = 1000 * 60 * 60 * 24;

export class AssignmentService {
  constructor(private readonly db = prismaClient) {}

  // Para un conjunto de unidades físicas, resuelve quién las tiene prestadas
  // actualmente (préstamo ACTIVO/PARCIAL vigente).
  async resolveAssignments(deviceUnitIds: string[]): Promise<Map<string, Assignment>> {
    const result = new Map<string, Assignment>();
    if (deviceUnitIds.length === 0) return result;

    const units = await this.db.loanItemUnit.findMany({
      where: {
        deviceUnitId: { in: deviceUnitIds },
        returned: false,
        loanItem: {
          loan: { status: { in: ["ACTIVE", "PARTIAL"] } },
        },
      },
      include: {
        loanItem: {
          include: {
            loan: {
              include: {
                custodian: true,
                department: { select: { name: true } },
              },
            },
          },
        },
      },
    });

    for (const u of units) {
      if (result.has(u.deviceUnitId)) continue;
      const p = u.loanItem.loan;
      result.set(u.deviceUnitId, {
        custodian: p.custodian?.name ?? "—",
        employeeNumber: p.custodian?.employeeNumber ?? null,
        department: p.department?.name ?? null,
        date: p.date,
        daysAssigned: p.date ? Math.floor((Date.now() - p.date.getTime()) / msPerDay) : null,
        source: "CUSTODY_LETTER",
        folio: p.number,
      });
    }

    return result;
  }

  async getAssignedDevicesReport(): Promise<AssignedDeviceRow[]> {
    const units = await this.db.deviceUnit.findMany({
      where: { status: "ON_LOAN" },
      include: { device: { include: { type: true } } },
      orderBy: { assetTag: "asc" },
    });

    const assignments = await this.resolveAssignments(units.map((u) => u.id));

    return units.map((u) => {
      const a = assignments.get(u.id);
      return {
        deviceId: u.id,
        assetTag: u.assetTag,
        description: u.device.name,
        brand: u.device.brand,
        model: u.device.model,
        type: u.device.type?.name ?? "",
        custodian: a?.custodian ?? "—",
        employeeNumber: a?.employeeNumber ?? null,
        department: a?.department ?? null,
        date: a?.date ?? null,
        daysAssigned: a?.daysAssigned ?? null,
        source: a?.source ?? "UNKNOWN",
        folio: a?.folio ?? null,
      };
    });
  }

  async getDevicesReport(): Promise<DeviceReportRow[]> {
    const units = await this.db.deviceUnit.findMany({
      orderBy: { assetTag: "asc" },
      include: {
        device: { include: { type: true } },
        department: { select: { id: true, name: true } },
      },
    });

    const loaned = units.filter((u) => u.status === "ON_LOAN").map((u) => u.id);
    const assignments = await this.resolveAssignments(loaned);

    return units.map((u) => {
      const assignment = u.status === "ON_LOAN" ? assignments.get(u.id) ?? null : null;
      return {
        deviceId: u.id,
        assetTag: u.assetTag,
        description: u.device.name,
        brand: u.device.brand,
        model: u.device.model,
        type: u.device.type?.name ?? "",
        serialNumber: u.serialNumber,
        hostname: u.hostname,
        ip: u.ip,
        macAddress: u.macAddress,
        area: u.area,
        departmentName: u.department?.name ?? null,
        // La web (y el resto del reporte) habla en términos de "ASIGNADO";
        // el inventario guarda la unidad como PRESTADO. Se normaliza aquí para
        // no filtrar el estado físico crudo al reporte (mismo criterio que
        // report.service.toRows).
        status: u.status === "ON_LOAN" ? "ASSIGNED" : u.status,
        batchId: null,
        quantity: 1,
        custodian: assignment?.custodian ?? null,
        employeeNumber: assignment?.employeeNumber ?? null,
        department: assignment?.department ?? null,
        date: assignment?.date ?? null,
        daysAssigned: assignment?.daysAssigned ?? null,
        source: assignment?.source ?? null,
        folio: assignment?.folio ?? null,
      };
    });
  }
}