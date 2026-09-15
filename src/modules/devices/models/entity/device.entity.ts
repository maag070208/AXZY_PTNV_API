import type { Device } from "@prisma/client";

export type DeviceEstado = "DISPONIBLE" | "ASIGNADO" | "BAJA";

export type DeviceFieldKey =
  | "numeroSerie"
  | "nombreEquipo"
  | "ip"
  | "macAddress"
  | "sistemaOp"
  | "ram"
  | "almacenamiento";

export interface DeviceFieldSetting {
  enabled: boolean;
  required: boolean;
}

export type DeviceFieldConfig = Record<DeviceFieldKey, DeviceFieldSetting>;

export interface DeviceEntity extends Device {}

export interface DeviceFilter {
  typeId?: string;
  estado?: string;
  q?: string;
  disponibleParaCarta?: boolean;
}

export interface DeviceInput {
  typeId: string;
  descripcion: string;
  marca: string;
  modelo: string;
  numeroSerie?: string;
  nombreEquipo?: string;
  area?: string;
  estado?: DeviceEstado;
  departmentId?: string;
  ip?: string | null;
  macAddress?: string | null;
  sistemaOp?: string | null;
  ram?: string | null;
  almacenamiento?: string | null;
}

export interface DeviceBatchUnit {
  numeroSerie?: string;
  nombreEquipo?: string;
  ip?: string;
  macAddress?: string;
}

export interface DeviceBatchInput {
  typeId: string;
  descripcion: string;
  marca: string;
  modelo: string;
  area?: string;
  estado?: DeviceEstado;
  departmentId?: string;
  sistemaOp?: string;
  ram?: string;
  almacenamiento?: string;
  units: DeviceBatchUnit[];
}

export interface LoteSharedInput {
  typeId?: string;
  descripcion?: string;
  marca?: string;
  modelo?: string;
  sistemaOp?: string;
  ram?: string;
  almacenamiento?: string;
}

export interface LoteUnitInput {
  id: string;
  numeroSerie?: string;
  nombreEquipo?: string;
  ip?: string;
  macAddress?: string;
  area?: string;
}