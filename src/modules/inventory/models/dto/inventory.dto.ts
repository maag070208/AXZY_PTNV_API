import { z } from "zod";

export const MovementTypeSchema = z.enum([
  "RETIREMENT",
  "MAINTENANCE_IN",
  "MAINTENANCE_OUT",
]);

export const ConditionSchema = z.enum(["GOOD", "FAIR", "POOR", "BROKEN"]);

export const CreateDeviceTypeSchema = z.object({
  code: z.string().min(1),
  name: z.string().min(1),
  assetTagPrefix: z.string().min(1),
  useSerialNumber: z.boolean().optional(),
  useMac: z.boolean().optional(),
  useIp: z.boolean().optional(),
  useHostname: z.boolean().optional(),
});

export const UpdateDeviceTypeSchema = z.object({
  name: z.string().optional(),
  assetTagPrefix: z.string().optional(),
  active: z.boolean().optional(),
  useSerialNumber: z.boolean().optional(),
  useMac: z.boolean().optional(),
  useIp: z.boolean().optional(),
  useHostname: z.boolean().optional(),
});

export const CreateUnitSchema = z.object({
  serialNumber: z.string().optional(),
  macAddress: z.string().optional(),
  ip: z.string().optional(),
  hostname: z.string().optional(),
});

export const CreateDeviceSchema = z.object({
  typeId: z.string().min(1),
  name: z.string().min(1),
  brand: z.string().min(1),
  model: z.string().min(1),
  description: z.string().optional(),
  notes: z.string().optional(),
  initialQuantity: z.number().int().min(1).max(5000).optional(),
  units: z.array(CreateUnitSchema).default([]),
});

export const UpdateDeviceSchema = z.object({
  name: z.string().optional(),
  brand: z.string().optional(),
  model: z.string().optional(),
  description: z.string().optional(),
  notes: z.string().optional(),
});

export const UpdateUnitSchema = z.object({
  serialNumber: z.string().optional(),
  macAddress: z.string().optional(),
  ip: z.string().optional(),
  hostname: z.string().optional(),
  area: z.string().optional(),
  departmentId: z.string().optional(),
});

export const MovementItemSchema = z.object({
  deviceId: z.string().min(1),
  quantity: z.number().int().min(1),
  condition: ConditionSchema.optional(),
  loanItemId: z.string().optional(),
  unitId: z.string().optional(),
  notes: z.string().optional(),
});

export const CreateMovementSchema = z.object({
  type: MovementTypeSchema,
  custodianId: z.string().optional(),
  departmentId: z.string().optional(),
  subareaId: z.string().optional(),
  reason: z.string().optional(),
  notes: z.string().optional(),
  loanId: z.string().optional(),
  movementId: z.string().optional(),
  items: z.array(MovementItemSchema).default([]),
});

export const CreateLoanSchema = z
  .object({
    custodianId: z.string().optional(),
    departmentId: z.string().optional(),
    subareaId: z.string().optional(),
    notes: z.string().optional(),
    items: z
      .array(
        z.object({
          deviceId: z.string().min(1),
          quantity: z.number().int().min(1),
        })
      )
      .min(1),
  })
  .refine((d) => !!d.custodianId || !!d.departmentId, {
    message: "CUSTODIAN_OR_DEPARTMENT_REQUIRED",
  });

export const UpdateLoanSchema = z
  .object({
    custodianId: z.string().optional(),
    departmentId: z.string().optional(),
    subareaId: z.string().optional(),
    notes: z.string().optional(),
    deviceId: z.string().optional(),
    quantity: z.number().int().min(1).optional(),
  })
  .refine((d) => Object.values(d).some((v) => v !== undefined), {
    message: "NO_CHANGES",
  });

export const CreateLoanReturnSchema = z.object({
  loanId: z.string().min(1),
  custodianId: z.string().optional(),
  notes: z.string().optional(),
  items: z
    .array(
      z.object({
        loanItemId: z.string().min(1),
        quantity: z.number().int().min(1),
        condition: ConditionSchema,
        notes: z.string().optional(),
      })
    )
    .min(1),
});