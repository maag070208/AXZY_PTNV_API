import { z } from "zod";
import { registry } from "@core/swagger/registry";

export const MovementTipoSchema = z.enum([
  "ENTRADA",
  "SALIDA",
  "TRASLADO",
  "BAJA",
  "PRESTAMO",
  "DEVOLUCION",
]);

export const MovementCondicionSchema = z.enum(["BUENO", "ACEPTABLE", "MALO", "ROTO"]);

export const MovementInputSchema = registry.register(
  "MovementInput",
  z.object({
    deviceId: z.string().min(1),
    tipo: MovementTipoSchema,
    locationId: z.string().optional(),
    notas: z.string().optional(),
    userId: z.string().optional(),
    userName: z.string().optional(),
    prestamoId: z.string().optional(),
    prestadoA: z.string().optional(),
    fechaRetornoEsperado: z.string().optional(),
    condicion: MovementCondicionSchema.optional(),
    motivoBaja: z.string().optional(),
    cartaId: z.string().optional(),
  })
);

export const MovementSchema = registry.register(
  "InventoryMovement",
  z.object({
    id: z.string(),
    deviceId: z.string(),
    tipo: MovementTipoSchema,
    locationId: z.string().nullable(),
    notas: z.string().nullable(),
    userId: z.string().nullable(),
    prestamoId: z.string().nullable(),
    prestadoA: z.string().nullable(),
    fechaRetornoEsperado: z.string().nullable(),
    condicion: MovementCondicionSchema.nullable(),
    motivoBaja: z.string().nullable(),
    cartaId: z.string().nullable(),
    createdAt: z.string(),
    device: z.record(z.string(), z.unknown()).nullable().optional(),
    location: z.record(z.string(), z.unknown()).nullable().optional(),
    user: z.record(z.string(), z.unknown()).nullable().optional(),
    prestamo: z.record(z.string(), z.unknown()).nullable().optional(),
  })
);

export const KardexSchema = registry.register(
  "Kardex",
  z.object({
    device: z.record(z.string(), z.unknown()),
    movements: z.array(MovementSchema),
  })
);

export const InventorySummarySchema = registry.register(
  "InventorySummary",
  z.object({
    locations: z.array(z.record(z.string(), z.unknown())),
    stats: z.object({
      totalDevices: z.number(),
      locatedDevices: z.number(),
      unlocatedDevices: z.number(),
    }),
  })
);