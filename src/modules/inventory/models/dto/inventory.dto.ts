import { z } from "zod";

export const TipoMovimientoSchema = z.enum([
  "BAJA",
  "MANTENIMIENTO_ENTRADA",
  "MANTENIMIENTO_SALIDA",
]);

export const CondicionSchema = z.enum(["BUENO", "ACEPTABLE", "MALO", "ROTO"]);

export const CreateTipoDispositivoSchema = z.object({
  code: z.string().min(1),
  name: z.string().min(1),
  folioPrefix: z.string().min(1),
  useSerie: z.boolean().optional(),
  useMac: z.boolean().optional(),
  useIp: z.boolean().optional(),
  useEquipo: z.boolean().optional(),
});

export const UpdateTipoDispositivoSchema = z.object({
  name: z.string().optional(),
  folioPrefix: z.string().optional(),
  active: z.boolean().optional(),
  useSerie: z.boolean().optional(),
  useMac: z.boolean().optional(),
  useIp: z.boolean().optional(),
  useEquipo: z.boolean().optional(),
});

export const CreateUnidadSchema = z.object({
  numeroSerie: z.string().optional(),
  macAddress: z.string().optional(),
  ip: z.string().optional(),
  nombreEquipo: z.string().optional(),
});

export const CreateDispositivoSchema = z.object({
  tipoId: z.string().min(1),
  nombre: z.string().min(1),
  marca: z.string().min(1),
  modelo: z.string().min(1),
  descripcion: z.string().optional(),
  observaciones: z.string().optional(),
  cantidadInicial: z.number().int().min(1).max(5000).optional(),
  unidades: z.array(CreateUnidadSchema).default([]),
});

export const UpdateDispositivoSchema = z.object({
  nombre: z.string().optional(),
  marca: z.string().optional(),
  modelo: z.string().optional(),
  descripcion: z.string().optional(),
  observaciones: z.string().optional(),
});

export const UpdateUnidadSchema = z.object({
  numeroSerie: z.string().optional(),
  macAddress: z.string().optional(),
  ip: z.string().optional(),
  nombreEquipo: z.string().optional(),
  area: z.string().optional(),
  departamentoId: z.string().optional(),
});

export const MovimientoDetalleSchema = z.object({
  dispositivoId: z.string().min(1),
  cantidad: z.number().int().min(1),
  condicion: CondicionSchema.optional(),
  prestamoDetalleId: z.string().optional(),
  unidadId: z.string().optional(),
  observaciones: z.string().optional(),
});

export const CreateMovimientoSchema = z.object({
  tipo: TipoMovimientoSchema,
  responsableId: z.string().optional(),
  departamentoId: z.string().optional(),
  subareaId: z.string().optional(),
  motivo: z.string().optional(),
  observaciones: z.string().optional(),
  prestamoId: z.string().optional(),
  movimientoId: z.string().optional(),
  detalles: z.array(MovimientoDetalleSchema).default([]),
});

export const CreatePrestamoSchema = z
  .object({
    responsableId: z.string().optional(),
    departamentoId: z.string().optional(),
    subareaId: z.string().optional(),
    observaciones: z.string().optional(),
    detalles: z
      .array(
        z.object({
          dispositivoId: z.string().min(1),
          cantidad: z.number().int().min(1),
        })
      )
      .min(1),
  })
  .refine((d) => !!d.responsableId || !!d.departamentoId, {
    message: "Indica un responsable o un departamento",
  });

export const UpdatePrestamoSchema = z
  .object({
    responsableId: z.string().optional(),
    departamentoId: z.string().optional(),
    subareaId: z.string().optional(),
    observaciones: z.string().optional(),
    dispositivoId: z.string().optional(),
    cantidad: z.number().int().min(1).optional(),
  })
  .refine((d) => Object.values(d).some((v) => v !== undefined), {
    message: "No hay cambios que aplicar",
  });

export const CreateDevolucionSchema = z.object({
  prestamoId: z.string().min(1),
  responsableId: z.string().optional(),
  observaciones: z.string().optional(),
  detalles: z
    .array(
      z.object({
        prestamoDetalleId: z.string().min(1),
        cantidad: z.number().int().min(1),
        condicion: CondicionSchema,
        observaciones: z.string().optional(),
      })
    )
    .min(1),
});