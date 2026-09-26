import { z, registry } from "@core/swagger/registry";
import { paginatedTableResponseSchema } from "@core/swagger/table.dto";

export const SubareaSchema = z
  .object({
    id: z.string(),
    departmentId: z.string(),
    name: z.string(),
    active: z.boolean(),
    createdAt: z.string(),
    department: z.object({ id: z.string(), name: z.string() }).optional(),
  })
  .openapi("Subarea");

export type Subarea = z.infer<typeof SubareaSchema>;

const PersonRefSchema = z.object({ id: z.string(), name: z.string() });

export const DepartmentTicketSchema = z
  .object({
    id: z.string(),
    title: z.string(),
    status: z.string(),
    priority: z.string(),
    category: z.string().nullable(),
    createdAt: z.string(),
    assignedTo: PersonRefSchema.nullable().optional(),
  })
  .openapi("DepartmentTicketSummary");

export const DepartmentCustodyLetterSchema = z
  .object({
    id: z.string(),
    consecutive: z.string(),
    date: z.string(),
    returnDate: z.string().nullable().optional(),
    custodian: PersonRefSchema.nullable().optional(),
    supervisor: PersonRefSchema.nullable().optional(),
    itemsCount: z.number(),
  })
  .openapi("DepartmentCustodyLetterSummary");

export const DepartmentSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    active: z.boolean(),
    createdAt: z.string(),
    updatedAt: z.string(),
    subareas: z.array(SubareaSchema).optional(),
    tickets: z.array(DepartmentTicketSchema).optional(),
    ticketsTotal: z.number().optional(),
    custodyLetters: z.array(DepartmentCustodyLetterSchema).optional(),
    custodyLettersTotal: z.number().optional(),
    _count: z.object({ users: z.number() }).optional(),
  })
  .openapi("Department");

export type Department = z.infer<typeof DepartmentSchema>;

export const DepartmentCreateDto = z
  .object({ name: z.string().min(2).max(80) })
  .openapi("DepartmentCreateInput");

export type DepartmentCreateInput = z.infer<typeof DepartmentCreateDto>;

export const DepartmentUpdateDto = z
  .object({
    name: z.string().min(2).max(80).optional(),
    active: z.boolean().optional(),
  })
  .openapi("DepartmentUpdateInput");

export type DepartmentUpdateInput = z.infer<typeof DepartmentUpdateDto>;

export const SubareaCreateDto = z
  .object({ departmentId: z.string(), name: z.string().min(1).max(80) })
  .openapi("SubareaCreateInput");

export type SubareaCreateInput = z.infer<typeof SubareaCreateDto>;

export const SubareaUpdateDto = z
  .object({
    name: z.string().min(1).max(80).optional(),
    active: z.boolean().optional(),
  })
  .openapi("SubareaUpdateInput");

export type SubareaUpdateInput = z.infer<typeof SubareaUpdateDto>;

export const DeleteResponseSchema = z
  .object({
    soft: z.boolean(),
    data: z.record(z.string(), z.unknown()),
  })
  .openapi("DeleteResponse");

export const DepartmentTableResponseSchema = paginatedTableResponseSchema(DepartmentSchema, "DepartmentTableResponse");
export const SubareaTableResponseSchema = paginatedTableResponseSchema(SubareaSchema, "SubareaTableResponse");

registry.register("Department", DepartmentSchema);
registry.register("DepartmentCreateInput", DepartmentCreateDto);
registry.register("DepartmentUpdateInput", DepartmentUpdateDto);
registry.register("Subarea", SubareaSchema);
registry.register("SubareaCreateInput", SubareaCreateDto);
registry.register("SubareaUpdateInput", SubareaUpdateDto);
registry.register("DepartmentTicketSummary", DepartmentTicketSchema);
registry.register("DepartmentCustodyLetterSummary", DepartmentCustodyLetterSchema);
registry.register("DeleteResponse", DeleteResponseSchema);
