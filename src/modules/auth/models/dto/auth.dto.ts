import { z, registry } from "@core/swagger/registry";

export const AuthUserSchema = z
  .object({
    id: z.string(),
    username: z.string(),
    email: z.string().nullish(),
    name: z.string(),
    role: z.enum([
      "ADMIN",
      "GERENTE",
      "JEFE_DE_AREA",
      "EMPLEADO",
      "RECURSOS_HUMANOS",
      "GUARD",
    ]),
    departmentId: z.string().nullish(),
  })
  .openapi("AuthUser");

export type AuthUser = z.infer<typeof AuthUserSchema>;

/** Alcance efectivo de un permiso (ver ROLES_Y_PERMISOS.md §2). */
export const AlcanceSchema = z
  .enum(["NINGUNO", "PROPIO", "AREA", "TODO"])
  .openapi("Alcance");

/**
 * `GET /auth/me`: el usuario de la sesión más lo que necesita su credencial
 * digital (la app la muestra al guardia). `fotoUrl` sigue el contrato de
 * `/access/lookup`: ruta RELATIVA a la base del API (`/personal/:id/foto/raw`),
 * sin host ni `/api/v1`; `null` si no tiene foto.
 *
 * `permisos` mapea clave de permiso → alcance, y solo incluye los distintos de
 * NINGUNO (p. ej. `{ "tickets.cerrar": "AREA" }`).
 */
export const AuthMeSchema = AuthUserSchema.extend({
  numeroEmpleado: z.string().nullable(),
  puesto: z.string().nullable(),
  department: z.object({ id: z.string(), name: z.string() }).nullable(),
  fotoUrl: z.string().nullable(),
  permisos: z.record(z.string(), AlcanceSchema),
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
registry.register("Alcance", AlcanceSchema);
registry.register("AuthMe", AuthMeSchema);
registry.register("LoginInput", LoginInputSchema);
registry.register("LoginResponse", LoginResponseSchema);