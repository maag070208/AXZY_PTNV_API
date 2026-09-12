import { z } from "zod";
import { registry } from "@core/swagger/registry";
import { TableQuerySchema, paginatedTableResponseSchema } from "@core/swagger/table.dto";

const ReportRowSchema = registry.register(
  "ReportRow",
  z
    .object({
      id: z.string(),
      fecha: z.string(),
      document_code: z.string(),
      employee_no: z.string().nullable(),
      responsible: z.string(),
      department: z.string(),
      subarea: z.string().nullable(),
      area_boss: z.string().nullable(),
      delivery_by: z.string(),
      return_date: z.string().nullable(),
      returned_by: z.string().nullable(),
      return_condition: z.string().nullable(),
      asset_code: z.string(),
      description: z.string(),
      cantidad: z.number(),
      brand: z.string().nullable(),
      model: z.string().nullable(),
      serial: z.string().nullable(),
      equipment_name: z.string().nullable(),
      estado: z.string(),
    })
    .openapi("ReportRow")
);

export const ReportListResponseSchema = z
  .object({ data: z.array(ReportRowSchema), total: z.number() })
  .openapi("ReportListResponse");
registry.register("ReportListResponse", ReportListResponseSchema);

export const ReportTableResponseSchema = paginatedTableResponseSchema(ReportRowSchema, "ReportTableResponse");

export const ReportQueryListSchema = TableQuerySchema;

const AsignadoRowSchema = registry.register(
  "AsignadoRow",
  z
    .object({
      deviceId: z.string(),
      controlActivos: z.string(),
      descripcion: z.string(),
      marca: z.string(),
      modelo: z.string(),
      tipo: z.string(),
      responsable: z.string(),
      numeroEmpleado: z.string().nullable(),
      departamento: z.string().nullable(),
      fecha: z.string().nullable(),
      diasAsignado: z.number().nullable(),
      origen: z.string(),
      folio: z.string().nullable(),
    })
    .openapi("AsignadoRow")
);

export const AsignadosListResponseSchema = z
  .object({ data: z.array(AsignadoRowSchema), total: z.number() })
  .openapi("AsignadosListResponse");
registry.register("AsignadosListResponse", AsignadosListResponseSchema);

const DeviceReportRowSchema = registry.register(
  "DeviceReportRow",
  z
    .object({
      deviceId: z.string(),
      controlActivos: z.string(),
      descripcion: z.string(),
      marca: z.string(),
      modelo: z.string(),
      tipo: z.string(),
      numeroSerie: z.string().nullable(),
      nombreEquipo: z.string().nullable(),
      ip: z.string().nullable(),
      macAddress: z.string().nullable(),
      area: z.string(),
      location: z.string().nullable(),
      estado: z.string(),
      loteId: z.string().nullable(),
      cantidad: z.number(),
      responsable: z.string().nullable(),
      numeroEmpleado: z.string().nullable(),
      departamento: z.string().nullable(),
      fecha: z.string().nullable(),
      diasAsignado: z.number().nullable(),
      origen: z.string().nullable(),
      folio: z.string().nullable(),
    })
    .openapi("DeviceReportRow")
);

export const DevicesListResponseSchema = z
  .object({ data: z.array(DeviceReportRowSchema), total: z.number() })
  .openapi("DevicesListResponse");
registry.register("DevicesListResponse", DevicesListResponseSchema);

export const ReportFiltersSchema = z.object({
  start: z.string().optional(),
  end: z.string().optional(),
  department: z.string().optional(),
  employee: z.string().optional(),
});