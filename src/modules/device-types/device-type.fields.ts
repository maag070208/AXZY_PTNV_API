export const DEVICE_FIELD_KEYS = [
  "numeroSerie",
  "nombreEquipo",
  "ip",
  "macAddress",
  "sistemaOp",
  "ram",
  "almacenamiento",
] as const;

export type DeviceFieldKey = (typeof DEVICE_FIELD_KEYS)[number];

export interface DeviceFieldSetting {
  enabled: boolean;
  required: boolean;
}

export type DeviceFieldConfig = Record<DeviceFieldKey, DeviceFieldSetting>;

const setting = (enabled = false, required = false): DeviceFieldSetting => ({
  enabled,
  required: enabled && required,
});

export const defaultDeviceFieldConfig = (code?: string | null): DeviceFieldConfig => {
  const normalized = code?.toUpperCase();
  const isComputer = normalized === "PC" || normalized === "LAPTOP" || normalized === "TABLET";
  const isPhoneOrPrinter = normalized === "TELEFONO" || normalized === "IMPRESORA";

  return {
    numeroSerie: setting(isComputer || isPhoneOrPrinter),
    nombreEquipo: setting(isComputer || isPhoneOrPrinter),
    ip: setting(isComputer),
    macAddress: setting(isComputer),
    sistemaOp: setting(isComputer),
    ram: setting(isComputer),
    almacenamiento: setting(isComputer),
  };
};

export const normalizeDeviceFieldConfig = (
  raw: unknown,
  code?: string | null
): DeviceFieldConfig => {
  const fallback = defaultDeviceFieldConfig(code);
  const source = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};

  return DEVICE_FIELD_KEYS.reduce((config, key) => {
    const value = source[key];
    const item = value && typeof value === "object" ? value as Record<string, unknown> : {};
    const enabled = typeof item.enabled === "boolean" ? item.enabled : fallback[key].enabled;
    config[key] = {
      enabled,
      required: enabled && item.required === true,
    };
    return config;
  }, {} as DeviceFieldConfig);
};
