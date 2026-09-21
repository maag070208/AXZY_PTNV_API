import { z, registry } from "@core/swagger/registry";

export const AuthUserSchema = z
  .object({
    id: z.string(),
    username: z.string(),
    email: z.string().nullish(),
    name: z.string(),
    role: z.enum(["ADMIN", "GERENTE", "JEFE_DE_AREA", "EMPLEADO", "RECURSOS_HUMANOS"]),
    departmentId: z.string().nullish(),
  })
  .openapi("AuthUser");

export type AuthUser = z.infer<typeof AuthUserSchema>;

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
registry.register("LoginInput", LoginInputSchema);
registry.register("LoginResponse", LoginResponseSchema);