import { filterDayRange, filterEnum, filterText, type TableFilters } from "@core/utils/table";
import type { AccessReportSessionRow } from "../models/entity/access.entity";

const INCIDENTS = ["ENTRY_WITHOUT_EXIT", "EXIT_WITHOUT_ENTRY", "OPEN_ENTRY"] as const;

/** Valor del filtro Incidencia para las sesiones completas (sin incidencia). */
export const NO_INCIDENT = "NONE";

const includes = (value: string | null | undefined, needle: string) =>
  (value ?? "").toLowerCase().includes(needle);

/**
 * Filtros de columna de los reportes de entradas/salidas (acceso y reloj
 * checador comparten filas y columnas). Las filas se calculan en memoria, así
 * que se filtran igual: empleado (nombre o número), departamento, puesto, día (`day`) e
 * incidencia. Los filtros de la barra (periodo, departamento, búsqueda) ya
 * acotaron las personas antes de emparejar.
 */
export const filterSessionRows = <T extends AccessReportSessionRow>(rows: T[], filters: TableFilters): T[] => {
  const employee = filterText(filters, "employeeName")?.contains.toLowerCase();
  const department = filterText(filters, "departmentName")?.contains.toLowerCase();
  const jobTitle = filterText(filters, "jobTitle")?.contains.toLowerCase();
  // "day" y no "date": `date` es el ancla del periodo que manda la barra.
  const day = filterDayRange(filters, "day");
  const from = day?.gte?.toISOString().slice(0, 10);
  const to = day?.lte?.toISOString().slice(0, 10);
  const incident = filterEnum(filters, "incident", [...INCIDENTS, NO_INCIDENT]);

  return rows.filter(
    (r) =>
      (!employee || includes(r.employeeName, employee) || includes(r.employeeNumber, employee)) &&
      (!department || includes(r.departmentName, department)) &&
      (!jobTitle || includes(r.jobTitle, jobTitle)) &&
      (!from || r.date >= from) &&
      (!to || r.date <= to) &&
      (!incident || (incident === NO_INCIDENT ? r.incident === null : r.incident === incident))
  );
};
