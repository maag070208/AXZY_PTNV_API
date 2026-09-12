import { HttpError } from "@core/middlewares/error.middleware";
import type {
  DeviceFieldConfig,
  DeviceFieldKey,
} from "../models/entity/device.entity";
import type { DeviceTypePort } from "./ports";

const MAC_REGEX = /^([0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}$/;
const IPV4_REGEX =
  /^(?:(?:25[0-5]|2[0-4]\d|[01]?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d?\d)$/;
const IPV6_REGEX =
  /^(?:[0-9A-Fa-f]{1,4}:){2,7}[0-9A-Fa-f]{1,4}$|^(?:[0-9A-Fa-f]{1,4}:){1,7}:$|^::1?$|^::$/;

export class DeviceFieldValidator {
  constructor(private readonly deviceTypePort: DeviceTypePort) {}

  configFor(
    type: { code: string; name?: string; fieldConfig?: unknown },
    field: DeviceFieldKey
  ) {
    return this.deviceTypePort.normalizeDeviceFieldConfig(type.fieldConfig, type.code)[
      field
    ];
  }

  normalize(
    type: { code: string; name?: string; fieldConfig?: unknown },
    field: DeviceFieldKey,
    value: unknown
  ): string | null | undefined {
    if (value === undefined) return undefined;
    const config = this.configFor(type, field);
    if (value === null || value === "") return null;
    const str = String(value).trim();
    if (str === "") return null;

    if (!config.enabled) {
      throw new HttpError(
        400,
        `El campo "${field}" no está habilitado para ${type.name ?? type.code}`
      );
    }

    if (field === "macAddress" && !MAC_REGEX.test(str)) {
      throw new HttpError(
        400,
        "MAC Address inválida. Formato esperado: AA:BB:CC:DD:EE:FF o AA-BB-CC-DD-EE-FF"
      );
    }

    if (field === "ip" && !(IPV4_REGEX.test(str) || IPV6_REGEX.test(str))) {
      throw new HttpError(400, "IP inválida. Use IPv4 (192.168.0.1) o IPv6 válido");
    }

    const maxLengths: Partial<Record<DeviceFieldKey, number>> = {
      ram: 40,
      almacenamiento: 120,
      sistemaOp: 80,
    };
    const max = maxLengths[field];
    if (max !== undefined && str.length > max) {
      const labels: Partial<Record<DeviceFieldKey, string>> = {
        ram: "RAM",
        almacenamiento: "Almacenamiento",
        sistemaOp: "Sistema Operativo",
      };
      throw new HttpError(400, `${labels[field]} excede ${max} caracteres`);
    }

    return str;
  }

  validateRequired(
    type: { code: string; fieldConfig?: unknown },
    values: Partial<Record<DeviceFieldKey, unknown>>
  ) {
    const config: DeviceFieldConfig = this.deviceTypePort.normalizeDeviceFieldConfig(
      type.fieldConfig,
      type.code
    );
    for (const [field, setting] of Object.entries(config) as [DeviceFieldKey, { enabled: boolean; required: boolean }][]) {
      if (
        setting.required &&
        (!setting.enabled ||
          values[field] === undefined ||
          values[field] === null ||
          String(values[field]).trim() === "")
      ) {
        throw new HttpError(400, `El campo "${field}" es obligatorio para ${type.code}`);
      }
    }
  }
}