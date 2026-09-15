import { z } from "zod";
import { registry } from "@core/swagger/registry";
import { TableQuerySchema, paginatedTableResponseSchema } from "@core/swagger/table.dto";

export const DeviceInputSchema = registry.register(
  "DeviceInput",
  z.object({
    typeId: z.string().min(1).openapi({ description: "ID del tipo de dispositivo" }),
    descripcion: z.string().min(1),
    marca: z.string().min(1),
    modelo: z.string().min(1),
    numeroSerie: z.string().optional(),
    nombreEquipo: z.string().optional(),
    area: z.string().optional(),
    estado: z.enum(["DISPONIBLE", "ASIGNADO", "BAJA"]).optional(),
    ip: z.string().optional(),
    macAddress: z.string().optional(),
    sistemaOp: z.string().optional(),
    ram: z.string().optional(),
    almacenamiento: z.string().optional(),
    departmentId: z.string().optional(),
  })
);

export const DeviceUpdateInputSchema = registry.register(
  "DeviceUpdateInput",
  DeviceInputSchema.extend({}).partial()
);

export const DeviceBatchUnitInputSchema = registry.register(
  "DeviceBatchUnitInput",
  z.object({
    numeroSerie: z.string().optional(),
    nombreEquipo: z.string().optional(),
    ip: z.string().optional(),
    macAddress: z.string().optional(),
  })
);

export const DeviceBatchInputSchema = registry.register(
  "DeviceBatchInput",
  z.object({
    typeId: z.string().min(1),
    descripcion: z.string().min(1),
    marca: z.string().min(1),
    modelo: z.string().min(1),
    area: z.string().optional(),
    estado: z.enum(["DISPONIBLE", "ASIGNADO", "BAJA"]).optional(),
    departmentId: z.string().optional(),
    sistemaOp: z.string().optional(),
    ram: z.string().optional(),
    almacenamiento: z.string().optional(),
    units: z.array(DeviceBatchUnitInputSchema).min(1).max(500),
  })
);

export const DeviceHistoryInputSchema = registry.register(
  "DeviceHistoryInput",
  z.object({
    type: z.string().min(1),
    detail: z.string().optional(),
  })
);

export const LoteUnitSchema = registry.register(
  "LoteUnit",
  z.object({
    id: z.string().min(1),
    numeroSerie: z.string().optional(),
    nombreEquipo: z.string().optional(),
    ip: z.string().optional(),
    macAddress: z.string().optional(),
    area: z.string().optional(),
  })
);

export const LoteUpdateInputSchema = registry.register(
  "LoteUpdateInput",
  z.object({
    typeId: z.string().optional(),
    descripcion: z.string().optional(),
    marca: z.string().optional(),
    modelo: z.string().optional(),
    sistemaOp: z.string().optional(),
    ram: z.string().optional(),
    almacenamiento: z.string().optional(),
    units: z.array(LoteUnitSchema).default([]),
  })
);

export const AddUnitsInputSchema = registry.register(
  "AddUnitsInput",
  z.object({
    cantidad: z.number().int().min(1).max(500),
  })
);

export const DevicesListSchema = registry.register(
  "DeviceRow",
  z
    .object({
      id: z.string(),
      typeId: z.string(),
      type: z.record(z.string(), z.unknown()).nullable().optional(),
      controlActivos: z.string(),
      descripcion: z.string(),
      marca: z.string(),
      modelo: z.string(),
      numeroSerie: z.string().nullable(),
      nombreEquipo: z.string().nullable(),
      area: z.string(),
      estado: z.enum(["DISPONIBLE", "ASIGNADO", "BAJA"]),
      departmentId: z.string().nullable(),
      loteId: z.string().nullable(),
      ip: z.string().nullable(),
      macAddress: z.string().nullable(),
      sistemaOp: z.string().nullable(),
      ram: z.string().nullable(),
      almacenamiento: z.string().nullable(),
      createdAt: z.string(),
      updatedAt: z.string(),
      loteSize: z.number().optional(),
      loteCount: z
        .object({
          disponible: z.number(),
          asignado: z.number(),
          baja: z.number(),
        })
        .optional(),
    })
    .openapi("Device")
);

export const DeviceTableResponseSchema = paginatedTableResponseSchema(DevicesListSchema, "DeviceTableResponse");

export const DeviceQueryListSchema = TableQuerySchema;

export const DeviceSummarySchema = registry.register(
  "DeviceSummary",
  z.object({
    total: z.number(),
    disponible: z.number(),
    asignado: z.number(),
    baja: z.number(),
    tipos: z.number(),
  })
);

export const DeviceHistoryItemSchema = registry.register(
  "DeviceHistoryItem",
  z.object({
    id: z.string(),
    deviceId: z.string(),
    type: z.string(),
    detail: z.string().nullable(),
    autorId: z.string().nullable(),
    autor: z
      .object({
        id: z.string(),
        name: z.string(),
        username: z.string(),
      })
      .nullable()
      .optional(),
    createdAt: z.string(),
  })
);