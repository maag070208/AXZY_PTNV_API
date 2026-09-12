import { z, registry } from "@core/swagger/registry";
import { paginatedTableResponseSchema } from "@core/swagger/table.dto";

export const SubareaSchema = z
  .object({
    id: z.string(),
    departmentId: z.string(),
    name: z.string(),
    active: z.boolean(),
    createdAt: z.string(),
  })
  .openapi("Subarea");

export type Subarea = z.infer<typeof SubareaSchema>;

export const DepartmentSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    active: z.boolean(),
    createdAt: z.string(),
    updatedAt: z.string(),
    subareas: z.array(SubareaSchema).optional(),
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
  .object({ name: z.string().min(1).max(80) })
  .openapi("SubareaCreateInput");

export type SubareaCreateInput = z.infer<typeof SubareaCreateDto>;

export const DeleteResponseSchema = z
  .object({
    soft: z.boolean(),
    data: z.record(z.string(), z.unknown()),
  })
  .openapi("DeleteResponse");

export const DepartmentTableResponseSchema = paginatedTableResponseSchema(DepartmentSchema, "DepartmentTableResponse");

registry.register("Department", DepartmentSchema);
registry.register("DepartmentCreateInput", DepartmentCreateDto);
registry.register("DepartmentUpdateInput", DepartmentUpdateDto);
registry.register("Subarea", SubareaSchema);
registry.register("SubareaCreateInput", SubareaCreateDto);
registry.register("DeleteResponse", DeleteResponseSchema);