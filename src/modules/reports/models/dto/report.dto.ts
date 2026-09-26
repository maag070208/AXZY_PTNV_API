import { z } from "zod";
import { registry } from "@core/swagger/registry";
import { TableQuerySchema, paginatedTableResponseSchema } from "@core/swagger/table.dto";

const ReportRowSchema = registry.register(
  "ReportRow",
  z
    .object({
      id: z.string(),
      date: z.string(),
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
      quantity: z.number(),
      brand: z.string().nullable(),
      model: z.string().nullable(),
      serial: z.string().nullable(),
      equipment_name: z.string().nullable(),
      status: z.string(),
    })
    .openapi("ReportRow")
);

export const ReportListResponseSchema = z
  .object({ data: z.array(ReportRowSchema), total: z.number() })
  .openapi("ReportListResponse");
registry.register("ReportListResponse", ReportListResponseSchema);

export const ReportTableResponseSchema = paginatedTableResponseSchema(ReportRowSchema, "ReportTableResponse");

export const ReportQueryListSchema = TableQuerySchema;

const AssignedDeviceRowSchema = registry.register(
  "AssignedDeviceRow",
  z
    .object({
      deviceId: z.string(),
      assetTag: z.string(),
      description: z.string(),
      brand: z.string(),
      model: z.string(),
      type: z.string(),
      custodian: z.string(),
      employeeNumber: z.string().nullable(),
      department: z.string().nullable(),
      date: z.string().nullable(),
      daysAssigned: z.number().nullable(),
      source: z.string(),
      folio: z.string().nullable(),
    })
    .openapi("AssignedDeviceRow")
);

export const AssignedDevicesListResponseSchema = z
  .object({ data: z.array(AssignedDeviceRowSchema), total: z.number() })
  .openapi("AssignedDevicesListResponse");
registry.register("AssignedDevicesListResponse", AssignedDevicesListResponseSchema);

const DeviceReportRowSchema = registry.register(
  "DeviceReportRow",
  z
    .object({
      deviceId: z.string(),
      assetTag: z.string(),
      description: z.string(),
      brand: z.string(),
      model: z.string(),
      type: z.string(),
      serialNumber: z.string().nullable(),
      hostname: z.string().nullable(),
      ip: z.string().nullable(),
      macAddress: z.string().nullable(),
      area: z.string(),
      departmentName: z.string().nullable(),
      status: z.enum(["AVAILABLE", "ASSIGNED", "DAMAGED", "IN_MAINTENANCE", "RETIRED"]),
      batchId: z.string().nullable(),
      quantity: z.number(),
      custodian: z.string().nullable(),
      employeeNumber: z.string().nullable(),
      department: z.string().nullable(),
      date: z.string().nullable(),
      daysAssigned: z.number().nullable(),
      source: z.string().nullable(),
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