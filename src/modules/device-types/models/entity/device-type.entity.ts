import type { DeviceFieldConfig, DeviceFieldKey } from "../fields/device-type.fields";

export interface DeviceTypeEntity {
  id: string;
  code: string;
  name: string;
  prefix: string;
  contador: number;
  cartaContador: number;
  active: boolean;
  fieldConfig: DeviceFieldConfig | null;
  createdAt: Date;
  updatedAt: Date;
  _count?: { devices: number };
}

export interface DeviceTypeCreateInput {
  code: string;
  name: string;
  prefix: string;
  fieldConfig?: Partial<DeviceFieldConfig>;
}

export interface DeviceTypeUpdateInput {
  name?: string;
  prefix?: string;
  active?: boolean;
  fieldConfig?: Partial<DeviceFieldConfig>;
}

export type { DeviceFieldKey };