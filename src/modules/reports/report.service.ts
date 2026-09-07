import { Response } from "express";
import { Prisma } from "@prisma/client";
import { prismaClient } from "@core/config/database";
import {
  type ITDataTableFetchParams,
  type ITDataTableResponse,
} from "@core/utils/table";

// ─── Reporte de asignados (dispositivos actualmente ASIGNADO) ───────
export interface AsignadoRow {
  deviceId: string;
  controlActivos: string;
  descripcion: string;
  marca: string;
  modelo: string;
  tipo: string;
  responsable: string;
  numeroEmpleado: string | null;
  departamento: string | null;
  fecha: Date | null;
  diasAsignado: number | null;
  origen: "CARTA" | "MOVIMIENTO" | "DESCONOCIDO";
  folio: string | null;
}


export interface ReportFilters {
  start?: string;
  end?: string;
  department?: string;
  employee?: string;
}

export interface ReportRow {
  id: string;
  fecha: Date;
  document_code: string;
  employee_no: string | null;
  responsible: string;
  department: string;
  subarea: string | null;
  area_boss: string | null;
  delivery_by: string;
  return_date: Date | null;
  returned_by: string | null;
  return_condition: string | null;
  asset_code: string;
  description: string;
  cantidad: number;
  brand: string | null;
  model: string | null;
  serial: string | null;
  equipment_name: string | null;
  estado: string;
}

const buildWhere = (filters: ReportFilters): Prisma.CartaResponsivaWhereInput => {
  const where: Prisma.CartaResponsivaWhereInput = {};
  if (filters.start) where.fecha = { ...(where.fecha as any), gte: new Date(filters.start) };
  if (filters.end) where.fecha = { ...(where.fecha as any), lte: new Date(filters.end + "T23:59:59") };
  if (filters.department) where.departamento = filters.department;
  if (filters.employee) {
    where.OR = [
      { responsable: { name: { contains: filters.employee, mode: "insensitive" } } },
      { numeroEmpleado: { contains: filters.employee, mode: "insensitive" } },
    ];
  }
  return where;
};

export const getReport = async (filters: ReportFilters): Promise<ReportRow[]> => {
  const where = buildWhere(filters);
  const cartas = await prismaClient.cartaResponsiva.findMany({
    where,
    orderBy: [{ fecha: "desc" }, { id: "desc" }],
    include: {
      items: { include: { device: true } },
      responsable: { select: { name: true } },
    },
  });

  return cartas.flatMap((c) =>
    c.items.map((it) => ({
      id: c.id,
      fecha: c.fecha,
      document_code: c.consecutive,
      employee_no: c.numeroEmpleado,
      responsible: c.responsable?.name ?? "",
      department: c.departamento,
      subarea: null,
      area_boss: c.areaBoss ?? "",
      delivery_by: c.deliveryBy,
      return_date: c.returnDate,
      returned_by: c.returnedBy ?? "",
      return_condition: c.returnCondition ?? "",
      asset_code: it.controlActivos,
      description: it.descripcion,
      cantidad: c.items.length,
      brand: it.marca,
      model: it.modelo,
      serial: it.numeroSerie,
      equipment_name: it.nombreEquipo,
      estado: c.returnDate ? "DEVUELTO" : "ASIGNADO",
    }))
  );
};

export const getReportTable = async (
  params: ITDataTableFetchParams
): Promise<ITDataTableResponse<ReportRow>> => {
  const { filters } = params;
  const where = buildWhere({
    start:
      typeof filters.start === "string" ? filters.start : undefined,
    end: typeof filters.end === "string" ? filters.end : undefined,
    department:
      typeof filters.department === "string" ? filters.department : undefined,
    employee:
      typeof filters.employee === "string" ? filters.employee : undefined,
  });

  const cartas = await prismaClient.cartaResponsiva.findMany({
    where,
    orderBy: [{ fecha: "desc" }, { id: "desc" }],
    include: {
      items: { include: { device: true } },
      responsable: { select: { name: true } },
    },
  });

  let rows: ReportRow[] = cartas.flatMap((c) =>
    c.items.map((it) => ({
      id: c.id,
      fecha: c.fecha,
      document_code: c.consecutive,
      employee_no: c.numeroEmpleado,
      responsible: c.responsable?.name ?? "",
      department: c.departamento,
      subarea: null,
      area_boss: c.areaBoss ?? "",
      delivery_by: c.deliveryBy,
      return_date: c.returnDate,
      returned_by: c.returnedBy ?? "",
      return_condition: c.returnCondition ?? "",
      asset_code: it.controlActivos,
      description: it.descripcion,
      cantidad: c.items.length,
      brand: it.marca,
      model: it.modelo,
      serial: it.numeroSerie,
      equipment_name: it.nombreEquipo,
      estado: c.returnDate ? "DEVUELTO" : "ASIGNADO",
    }))
  );

  const sorters: Record<string, (a: ReportRow, b: ReportRow) => number> = {
    fecha: (a, b) => a.fecha.getTime() - b.fecha.getTime(),
    document_code: (a, b) => a.document_code.localeCompare(b.document_code),
    employee_no: (a, b) => (a.employee_no ?? "").localeCompare(b.employee_no ?? ""),
    responsible: (a, b) => a.responsible.localeCompare(b.responsible),
    department: (a, b) => a.department.localeCompare(b.department),
    asset_code: (a, b) => a.asset_code.localeCompare(b.asset_code),
    description: (a, b) => a.description.localeCompare(b.description),
    cantidad: (a, b) => a.cantidad - b.cantidad,
    estado: (a, b) => a.estado.localeCompare(b.estado),
  };

  if (params.sort && sorters[params.sort.key]) {
    const cmp = sorters[params.sort.key];
    rows = [...rows].sort(
      params.sort.direction === "asc" ? cmp : (a, b) => cmp(b, a)
    );
  }

  const total = rows.length;
  const start = (params.page - 1) * params.limit;
  return { data: rows.slice(start, start + params.limit), total };
};

const fmtDate = (d: Date | null): string => {
  if (!d) return "";
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yy = d.getFullYear();
  return `${yy}-${mm}-${dd}`;
};

const CSV_HEADERS = [
  "Fecha",
  "Documento",
  "No. empleado",
  "Responsable",
  "Departamento",
  "Subarea",
  "Jefe de area",
  "Entrega",
  "Activo",
  "Descripcion",
  "Cantidad",
  "Marca",
  "Modelo",
  "Serie",
  "Nombre equipo",
  "Estado",
  "Fecha devolucion",
  "Resguardo",
  "Condicion devolucion",
];

const csvEscape = (v: string): string => {
  if (v.includes(",") || v.includes('"') || v.includes("\n")) {
    return `"${v.replace(/"/g, '""')}"`;
  }
  return v;
};

export const streamCsv = (res: Response, rows: ReportRow[]) => {
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader(
    "Content-Disposition",
    'attachment; filename="reporte_entregas.csv"'
  );
  res.write(CSV_HEADERS.join(",") + "\n");
  for (const r of rows) {
    const line = [
      fmtDate(r.fecha),
      r.document_code,
      r.employee_no ?? "",
      r.responsible,
      r.department,
      r.subarea ?? "",
      r.area_boss ?? "",
      r.delivery_by,
      r.asset_code,
      r.description,
      String(r.cantidad),
      r.brand ?? "",
      r.model ?? "",
      r.serial ?? "",
      r.equipment_name ?? "",
      r.estado,
      fmtDate(r.return_date),
      r.returned_by ?? "",
      r.return_condition ?? "",
    ]
      .map(csvEscape)
      .join(",");
    res.write(line + "\n");
  }
  res.end();
};
const msPerDay = 1000 * 60 * 60 * 24;

export const getAsignadosReport = async (): Promise<AsignadoRow[]> => {
  const devices = await prismaClient.device.findMany({
    where: { estado: "ASIGNADO" },
    include: { type: true },
    orderBy: { controlActivos: "asc" },
  });

  const rows: AsignadoRow[] = [];

  for (const d of devices) {
    // 1) Carta responsiva activa (sin devolución) que incluya este dispositivo.
    const cartaItem = await prismaClient.cartaItem.findFirst({
      where: { deviceId: d.id, carta: { returnDate: null } },
      include: { carta: { include: { responsable: true } } },
      orderBy: { carta: { fecha: "desc" } },
    });

    if (cartaItem?.carta) {
      const c = cartaItem.carta;
      const diasAsignado = c.fecha
        ? Math.floor((Date.now() - c.fecha.getTime()) / msPerDay)
        : null;
      rows.push({
        deviceId: d.id,
        controlActivos: d.controlActivos,
        descripcion: d.descripcion,
        marca: d.marca,
        modelo: d.modelo,
        tipo: d.type?.name ?? "",
        responsable: c.responsable?.name ?? c.numeroEmpleado ?? "—",
        numeroEmpleado: c.numeroEmpleado,
        departamento: c.departamento,
        fecha: c.fecha,
        diasAsignado,
        origen: "CARTA",
        folio: c.consecutive,
      });
      continue;
    }

    // 2) Sin carta: último movimiento de salida/asignación del dispositivo.
    const movement = await prismaClient.inventoryMovement.findFirst({
      where: { deviceId: d.id, tipo: { in: ["SALIDA", "PRESTAMO"] } },
      orderBy: { createdAt: "desc" },
    });

    const diasAsignado = movement?.createdAt
      ? Math.floor((Date.now() - movement.createdAt.getTime()) / msPerDay)
      : null;

    rows.push({
      deviceId: d.id,
      controlActivos: d.controlActivos,
      descripcion: d.descripcion,
      marca: d.marca,
      modelo: d.modelo,
      tipo: d.type?.name ?? "",
      responsable: movement?.prestadoA ?? "—",
      numeroEmpleado: null,
      departamento: null,
      fecha: movement?.createdAt ?? null,
      diasAsignado,
      origen: movement ? "MOVIMIENTO" : "DESCONOCIDO",
      folio: null,
    });
  }

  return rows;
};

// ─── Reporte de dispositivos (inventario completo) ──────────────────
export interface DeviceReportRow {
  deviceId: string;
  controlActivos: string;
  descripcion: string;
  marca: string;
  modelo: string;
  tipo: string;
  numeroSerie: string | null;
  nombreEquipo: string | null;
  ip: string | null;
  macAddress: string | null;
  area: string;
  location: string | null;
  estado: string;
  loteId: string | null;
  cantidad: number;
  // Asignación activa (solo si estado === "ASIGNADO")
  responsable: string | null;
  numeroEmpleado: string | null;
  departamento: string | null;
  fecha: Date | null;
  diasAsignado: number | null;
  origen: "CARTA" | "MOVIMIENTO" | "DESCONOCIDO" | null;
  folio: string | null;
}

export const getDevicesReport = async (): Promise<DeviceReportRow[]> => {
  const devices = await prismaClient.device.findMany({
    orderBy: { controlActivos: "asc" },
    include: { type: true, location: true },
  });

  const loteIds = Array.from(
    new Set(devices.map((d) => d.loteId).filter((v): v is string => !!v))
  );
  let loteSizes: Record<string, number> = {};
  if (loteIds.length > 0) {
    const grouped = await prismaClient.device.groupBy({
      by: ["loteId"],
      where: { loteId: { in: loteIds } },
      _count: { _all: true },
    });
    loteSizes = Object.fromEntries(
      grouped.map((g) => [g.loteId as string, g._count._all as number])
    );
  }

  const rows: DeviceReportRow[] = [];

  for (const d of devices) {
    let asignacion: {
      responsable: string;
      numeroEmpleado: string | null;
      departamento: string | null;
      fecha: Date | null;
      diasAsignado: number | null;
      origen: DeviceReportRow["origen"];
      folio: string | null;
    } | null = null;

    if (d.estado === "ASIGNADO") {
      const cartaItem = await prismaClient.cartaItem.findFirst({
        where: { deviceId: d.id, carta: { returnDate: null } },
        include: { carta: { include: { responsable: true } } },
        orderBy: { carta: { fecha: "desc" } },
      });

      if (cartaItem?.carta) {
        const c = cartaItem.carta;
        asignacion = {
          responsable: c.responsable?.name ?? c.numeroEmpleado ?? "—",
          numeroEmpleado: c.numeroEmpleado,
          departamento: c.departamento,
          fecha: c.fecha,
          diasAsignado: c.fecha
            ? Math.floor((Date.now() - c.fecha.getTime()) / msPerDay)
            : null,
          origen: "CARTA",
          folio: c.consecutive,
        };
      } else {
        const movement = await prismaClient.inventoryMovement.findFirst({
          where: { deviceId: d.id, tipo: { in: ["SALIDA", "PRESTAMO"] } },
          orderBy: { createdAt: "desc" },
        });
        asignacion = {
          responsable: movement?.prestadoA ?? "—",
          numeroEmpleado: null,
          departamento: null,
          fecha: movement?.createdAt ?? null,
          diasAsignado: movement?.createdAt
            ? Math.floor((Date.now() - movement.createdAt.getTime()) / msPerDay)
            : null,
          origen: movement ? "MOVIMIENTO" : "DESCONOCIDO",
          folio: null,
        };
      }
    }

    rows.push({
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
      location: d.location
        ? [d.location.lugar, d.location.subLugar, d.location.numero].filter(Boolean).join(" ") || d.location.descripcion || null
        : null,
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
    });
  }

  return rows;
};
