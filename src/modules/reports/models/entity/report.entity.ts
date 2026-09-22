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

export type AsignacionOrigen = "CARTA" | "MOVIMIENTO" | "DESCONOCIDO";

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
  origen: AsignacionOrigen;
  folio: string | null;
}

export type DeviceEstado =
  | "DISPONIBLE"
  | "ASIGNADO"
  | "DANADO"
  | "MANTENIMIENTO"
  | "BAJA";

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
  departmentName: string | null;
  estado: DeviceEstado;
  loteId: string | null;
  cantidad: number;
  responsable: string | null;
  numeroEmpleado: string | null;
  departamento: string | null;
  fecha: Date | null;
  diasAsignado: number | null;
  origen: AsignacionOrigen | null;
  folio: string | null;
}

export interface Asignacion {
  responsable: string;
  numeroEmpleado: string | null;
  departamento: string | null;
  fecha: Date | null;
  diasAsignado: number | null;
  origen: AsignacionOrigen;
  folio: string | null;
}