import { z } from "zod";

/**
 * Movimientos que se registran a mano. `STOCK_IN` es el alta de piezas NUEVAS de
 * un dispositivo que ya existe (llegó más mercancía): crea las unidades con su
 * folio y liga el movimiento, igual que el alta del dispositivo.
 */
export const MovementTypeSchema = z.enum([
  "STOCK_IN",
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
});

/**
 * Unidades físicas exactas (por id). Es la forma de prestar y devolver que deja
 * la carta igual a lo entregado: con cantidad, la API elige las unidades.
 */
const UnitIdsSchema = z
  .array(z.string().min(1))
  .min(1)
  .refine((ids) => new Set(ids).size === ids.length, { message: "DUPLICATE_UNITS" });

/** `quantity` o `unitIds` (si vienen ambos, deben coincidir). */
const quantityOrUnits = <T extends { quantity?: number; unitIds?: string[] }>(schema: z.ZodType<T>) =>
  schema
    .refine((i) => i.quantity !== undefined || i.unitIds !== undefined, { message: "QUANTITY_OR_UNITS_REQUIRED" })
    .refine((i) => !i.unitIds || i.quantity === undefined || i.quantity === i.unitIds.length, {
      message: "QUANTITY_UNITS_MISMATCH",
    });

/**
 * Un renglón de movimiento: por cantidad o por unidades exactas (`unitId` para
 * una sola, `unitIds` para varias). La baja y el mantenimiento ya registran las
 * piezas que mueven, vengan como vengan.
 */
export const MovementItemSchema = z
  .object({
    deviceId: z.string().min(1),
    /** Un tope como el del alta: arriba de esto, la carga va por Excel. */
    quantity: z.number().int().min(1).max(5000).optional(),
    condition: ConditionSchema.optional(),
    loanItemId: z.string().optional(),
    unitId: z.string().optional(),
    unitIds: UnitIdsSchema.optional(),
    notes: z.string().optional(),
  })
  .refine((i) => i.quantity !== undefined || i.unitId !== undefined || i.unitIds !== undefined, {
    message: "QUANTITY_OR_UNITS_REQUIRED",
  })
  .refine((i) => !i.unitIds || i.quantity === undefined || i.quantity === i.unitIds.length, {
    message: "QUANTITY_UNITS_MISMATCH",
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
        quantityOrUnits(
          z.object({
            deviceId: z.string().min(1),
            quantity: z.number().int().min(1).optional(),
            unitIds: UnitIdsSchema.optional(),
          })
        )
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
    /** Reemplaza las unidades del préstamo por estas (del mismo dispositivo). */
    unitIds: UnitIdsSchema.optional(),
  })
  .refine((d) => Object.values(d).some((v) => v !== undefined), {
    message: "NO_CHANGES",
  })
  .refine((d) => !d.unitIds || d.quantity === undefined || d.quantity === d.unitIds.length, {
    message: "QUANTITY_UNITS_MISMATCH",
  });

export const CreateLoanReturnSchema = z.object({
  loanId: z.string().min(1),
  custodianId: z.string().optional(),
  notes: z.string().optional(),
  items: z
    .array(
      quantityOrUnits(
        z.object({
          loanItemId: z.string().min(1),
          quantity: z.number().int().min(1).optional(),
          /** Unidades pendientes de ese renglón que regresan con esta condición. */
          unitIds: UnitIdsSchema.optional(),
          condition: ConditionSchema,
          notes: z.string().optional(),
        })
      )
    )
    .min(1),
});