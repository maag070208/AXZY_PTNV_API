import { z, registry } from "@core/swagger/registry";
import { paginatedTableResponseSchema } from "@core/swagger/table.dto";

const RoleSchema = z.enum([
  "ADMIN",
  "MANAGER",
  "AREA_HEAD",
  "EMPLOYEE",
  "HUMAN_RESOURCES",
  "GUARD",
]);

export const UserSchema = z
  .object({
    id: z.string(),
    username: z.string(),
    email: z.string().nullish(),
    name: z.string(),
    middleName: z.string().nullish(),
    paternalSurname: z.string().nullish(),
    maternalSurname: z.string().nullish(),
    role: RoleSchema,
    active: z.boolean(),
    jobTitle: z.string().nullish(),
    employeeNumber: z.string().nullish(),
    company: z.string().nullish(),
    departmentId: z.string().nullish(),
    department: z.object({ id: z.string(), name: z.string() }).nullish(),
    subareaId: z.string().nullish(),
    subarea: z.object({ id: z.string(), name: z.string() }).nullish(),
    deactivatedAt: z.string().nullish(),
    deactivatedById: z.string().nullish(),
    deactivatedBy: z
      .object({
        id: z.string(),
        name: z.string(),
      })
      .nullish(),
    deactivationReason: z.string().nullish(),
    createdAt: z.string(),
  })
  .openapi("User");

export type User = z.infer<typeof UserSchema>;

export const UserCreateDto = z
  .object({
    username: z.string().min(3, "El usuario debe tener al menos 3 caracteres"),
    email: z
      .string()
      .email("Email inválido")
      .optional()
      .or(z.literal("").transform(() => undefined)),
    password: z.string().min(6, "La contraseña debe tener al menos 6 caracteres"),
    name: z.string().min(1),
    middleName: z.string().optional(),
    paternalSurname: z.string().optional(),
    maternalSurname: z.string().optional(),
    role: RoleSchema.optional(),
    jobTitle: z.string().optional(),
    employeeNumber: z.string().optional(),
    company: z.string().optional(),
    departmentId: z.string().optional(),
    subareaId: z.string().optional(),
  })
  .openapi("UserCreateInput");

export type UserCreateInput = z.infer<typeof UserCreateDto>;

export const UserUpdateDto = z
  .object({
    name: z.string().optional(),
    middleName: z.string().nullable().optional(),
    paternalSurname: z.string().nullable().optional(),
    maternalSurname: z.string().nullable().optional(),
    email: z
      .string()
      .email("Email inválido")
      .nullable()
      .optional()
      .or(z.literal("").transform(() => null)),
    role: RoleSchema.optional(),
    active: z.boolean().optional(),
    jobTitle: z.string().optional(),
    employeeNumber: z.string().optional(),
    company: z.string().optional(),
    departmentId: z.string().nullable().optional(),
    subareaId: z.string().nullable().optional(),
  })
  .openapi("UserUpdateInput");

export type UserUpdateInput = z.infer<typeof UserUpdateDto>;

export const UserPasswordDto = z
  .object({ password: z.string().min(6, "La contraseña debe tener al menos 6 caracteres") })
  .openapi("UserPasswordInput");

export const UserTableResponseSchema = paginatedTableResponseSchema(UserSchema, "UserTableResponse");

export const UserImportResultSchema = z
  .object({
    created: z.number(),
    skipped: z.array(
      z.object({
        row: z.number(),
        username: z.string(),
        reason: z.string(),
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

export const DeactivateUserDto = z
  .object({
    reason: z.string().min(3, "El motivo debe tener al menos 3 caracteres").max(500),
    notifyUser: z.boolean().default(true),
  })
  .openapi("UserDeactivateInput");
export type DeactivateUserInput = z.infer<typeof DeactivateUserDto>;

export const ReactivateUserDto = z.object({}).openapi("UserReactivateInput");
export type ReactivateUserInput = z.infer<typeof ReactivateUserDto>;

export const UserDeactivateResponseSchema = z
  .object({
    id: z.string(),
    active: z.boolean(),
    deactivatedAt: z.string().nullable(),
    deactivatedById: z.string().nullable(),
    deactivationReason: z.string().nullable(),
  })
  .openapi("UserDeactivateResponse");
export type UserDeactivateResponse = z.infer<typeof UserDeactivateResponseSchema>;

registry.register("User", UserSchema);
registry.register("UserCreateInput", UserCreateDto);
registry.register("UserUpdateInput", UserUpdateDto);
registry.register("UserPasswordInput", UserPasswordDto);
registry.register("UserImportResult", UserImportResultSchema);
registry.register("UserHistoryEntry", UserHistoryEntrySchema);
registry.register("UserDeleteResponse", UserDeleteResponseSchema);
registry.register("UserDeactivateInput", DeactivateUserDto);
registry.register("UserReactivateInput", ReactivateUserDto);
registry.register("UserDeactivateResponse", UserDeactivateResponseSchema);