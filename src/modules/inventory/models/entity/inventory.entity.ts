export type DeviceUnitStatus = "AVAILABLE" | "ON_LOAN" | "DAMAGED" | "IN_MAINTENANCE" | "RETIRED";

export type MovementType =
  | "STOCK_IN"
  | "LOAN"
  | "RETURN"
  | "RETIREMENT"
  | "TRANSFER"
  | "ADJUSTMENT_IN"
  | "ADJUSTMENT_OUT"
  | "MAINTENANCE_IN"
  | "MAINTENANCE_OUT"
  | "REVERSAL";

export type Condition = "GOOD" | "FAIR" | "POOR" | "BROKEN";

export interface MovementItemInput {
  deviceId: string;
  quantity: number;
  condition?: Condition;
  loanItemId?: string;
  unitId?: string;
  notes?: string;
}

export interface CreateDeviceTypeInput {
  code: string;
  name: string;
  assetTagPrefix: string;
  useSerialNumber?: boolean;
  useMac?: boolean;
  useIp?: boolean;
  useHostname?: boolean;
}

export interface UpdateDeviceTypeInput {
  name?: string;
  assetTagPrefix?: string;
  active?: boolean;
  useSerialNumber?: boolean;
  useMac?: boolean;
  useIp?: boolean;
  useHostname?: boolean;
}

export interface CreateUnitInput {
  serialNumber?: string;
  macAddress?: string;
  ip?: string;
  hostname?: string;
}

export interface CreateDeviceInput {
  typeId: string;
  name: string;
  brand: string;
  model: string;
  description?: string;
  notes?: string;
  initialQuantity?: number;
  units?: CreateUnitInput[];
}

export interface UpdateDeviceInput {
  name?: string;
  brand?: string;
  model?: string;
  description?: string;
  notes?: string;
}

export interface UpdateUnitInput {
  serialNumber?: string;
  macAddress?: string;
  ip?: string;
  hostname?: string;
  area?: string;
  departmentId?: string;
}

export interface UpdateUnitInput {
  serialNumber?: string;
  macAddress?: string;
  ip?: string;
  hostname?: string;
  area?: string;
  departmentId?: string;
}

export interface UpdateUnitInput {
  serialNumber?: string;
  macAddress?: string;
  ip?: string;
  hostname?: string;
  area?: string;
  departmentId?: string;
}

export interface CreateMovementInput {
  type: MovementType;
  custodianId?: string;
  departmentId?: string;
  subareaId?: string;
  reason?: string;
  notes?: string;
  loanId?: string;
  movementId?: string;
  items: MovementItemInput[];
}

export interface CreateLoanInput {
  custodianId?: string;
  departmentId?: string;
  subareaId?: string;
  notes?: string;
  items: { deviceId: string; quantity: number }[];
}

export interface UpdateLoanInput {
  custodianId?: string;
  departmentId?: string;
  subareaId?: string;
  notes?: string;
  deviceId?: string;
  quantity?: number;
}

export interface CreateLoanReturnInput {
  loanId: string;
  custodianId?: string;
  notes?: string;
  items: { loanItemId: string; quantity: number; condition: Condition; notes?: string }[];
}