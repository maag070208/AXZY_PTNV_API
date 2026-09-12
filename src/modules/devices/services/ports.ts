import type { DeviceFieldConfig, DeviceFieldKey } from "../models/entity/device.entity";

export interface DeviceTypePort {
  formatPrefix(prefix: string, n: number): string;
  normalizeDeviceFieldConfig(
    raw: unknown,
    code?: string | null
  ): DeviceFieldConfig;
}

export type { DeviceFieldKey };