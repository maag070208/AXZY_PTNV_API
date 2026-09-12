import { z, registry } from "@core/swagger/registry";
import { paginatedTableResponseSchema } from "@core/swagger/table.dto";

const RoleSchema = z.enum(["ADMIN", "GERENTE", "JEFE_DE_AREA", "EMPLEADO"]);

export const UserSchema = z
  .object({
    id: z.string(),
    username: z.string(),
    email: z.string().nullish(),
    name: z.string(),
    role: RoleSchema,
    active: z.boolean(),
    puesto: z.string().nullish(),
    numeroEmpleado: z.string().nullish(),
    empresa: z.string().nullish(),
    departmentId: z.string().nullish(),
    department: z.object({ id: z.string(), name: z.string() }).nullish(),
    subareaId: z.string().nullish(),
    subarea: z.object({ id: z.string(), name: z.string() }).nullish(),
    createdAt: z.string(),
  })
  .openapi("User");

export type User = z.infer<typeof UserSchema>;

export const UserCreateDto = z
  .object({
    username: z.string().min(3),
    email: z.string().email().optional(),
    password: z.string().min(6),
    name: z.string().min(1),
    role: RoleSchema.optional(),
    puesto: z.string().optional(),
    numeroEmpleado: z.string().optional(),
    empresa: z.string().optional(),
    departmentId: z.string().optional(),
    subareaId: z.string().optional(),
  })
  .openapi("UserCreateInput");

export type UserCreateInput = z.infer<typeof UserCreateDto>;

export const UserUpdateDto = z
  .object({
    name: z.string().optional(),
    email: z.string().email().nullable().optional(),
    role: RoleSchema.optional(),
    active: z.boolean().optional(),
    puesto: z.string().optional(),
    numeroEmpleado: z.string().optional(),
    empresa: z.string().optional(),
    departmentId: z.string().nullable().optional(),
    subareaId: z.string().nullable().optional(),
  })
  .openapi("UserUpdateInput");

export type UserUpdateInput = z.infer<typeof UserUpdateDto>;

export const UserPasswordDto = z
  .object({ password: z.string().min(6) })
  .openapi("UserPasswordInput");

export const UserTableResponseSchema = paginatedTableResponseSchema(UserSchema, "UserTableResponse");

export const UserImportResultSchema = z
  .object({
    creados: z.number(),
    omitidos: z.array(
      z.object({
        fila: z.number(),
        username: z.string(),
        motivo: z.string(),
      })
    ),
  })
  .openapi("UserImportResult");

export const UserHistoryEntrySchema = z
  .object({
    id: z.string(),
    type: z.string(),
    title: z.string(),
    detail: z.string(),
    timestamp: z.string(),
    refId: z.string().optional(),
  })
  .openapi("UserHistoryEntry");

export const UserDeleteResponseSchema = z
  .object({
    soft: z.boolean(),
    forced: z.boolean().optional(),
    data: z.record(z.string(), z.unknown()),
  })
  .openapi("UserDeleteResponse");

registry.register("User", UserSchema);
registry.register("UserCreateInput", UserCreateDto);
registry.register("UserUpdateInput", UserUpdateDto);
registry.register("UserPasswordInput", UserPasswordDto);
registry.register("UserImportResult", UserImportResultSchema);
registry.register("UserHistoryEntry", UserHistoryEntrySchema);
registry.register("UserDeleteResponse", UserDeleteResponseSchema);