import { z, registry } from "@core/swagger/registry";
import { LANGUAGES } from "@core/i18n";

export const AuthUserSchema = z
  .object({
    id: z.string(),
    username: z.string(),
    email: z.string().nullish(),
    name: z.string(),
    role: z.enum([
      "ADMIN",
      "MANAGER",
      "AREA_HEAD",
      "EMPLOYEE",
      "HUMAN_RESOURCES",
      "GUARD",
    ]),
    departmentId: z.string().nullish(),
  })
  .openapi("AuthUser");

export type AuthUser = z.infer<typeof AuthUserSchema>;

/** Alcance efectivo de un permiso (ver ROLES_Y_PERMISOS.md §2). */
export const ScopeSchema = z
  .enum(["NONE", "OWN", "AREA", "ALL"])
  .openapi("PermissionScope");

/**
 * `GET /auth/me`: el usuario de la sesión más lo que necesita su credencial
 * digital (la app la muestra al guardia). `photoUrl` sigue el contrato de
 * `/access/lookup`: ruta RELATIVA a la base del API (`/hr/:id/photo/raw`),
 * sin host ni `/api/v1`; `null` si no tiene foto.
 *
 * `permissions` mapea clave de permiso → alcance, y solo incluye los distintos
 * de NONE (p. ej. `{ "tickets.close": "AREA" }`). `language` es el idioma del
 * sistema (`sys_config.LANGUAGE`), que la web adopta para su interfaz.
 */
export const AuthMeSchema = AuthUserSchema.extend({
  employeeNumber: z.string().nullable(),
  jobTitle: z.string().nullable(),
  department: z.object({ id: z.string(), name: z.string() }).nullable(),
  photoUrl: z.string().nullable(),
  permissions: z.record(z.string(), ScopeSchema),
  language: z.enum(LANGUAGES),
}).openapi("AuthMe");

export type AuthMe = z.infer<typeof AuthMeSchema>;

export const LoginInputSchema = z
  .object({
    username: z.string().min(1),
    password: z.string().min(1),
  })
  .openapi("LoginInput");

export type LoginInput = z.infer<typeof LoginInputSchema>;

export const LoginResponseSchema = z
  .object({
    token: z.string(),
    user: AuthUserSchema,
  })
  .openapi("LoginResponse");

export type LoginResponse = z.infer<typeof LoginResponseSchema>;

registry.register("AuthUser", AuthUserSchema);
registry.register("PermissionScope", ScopeSchema);
registry.register("AuthMe", AuthMeSchema);
registry.register("LoginInput", LoginInputSchema);
registry.register("LoginResponse", LoginResponseSchema);