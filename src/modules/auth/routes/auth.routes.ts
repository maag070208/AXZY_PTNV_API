import { Router } from "express";
import { authenticate } from "@core/middlewares/auth.middleware";
import { asyncHandler } from "@core/utils/asyncHandler";
import { registerPath } from "@core/swagger/registry";
import { LoginInputSchema, LoginResponseSchema, AuthUserSchema } from "../models/dto/auth.dto";
import type { AuthController } from "../controllers/auth.controller";

export const createAuthRouter = (controller: AuthController): Router => {
  const router = Router();

  registerPath({
    method: "post",
    path: "/auth/login",
    tags: ["Auth"],
    summary: "Iniciar sesión",
    description: "Valida credenciales y devuelve un token JWT.",
    request: {
      body: {
        required: true,
        content: { "application/json": { schema: LoginInputSchema } },
      },
    },
    responses: {
      200: {
        description: "Token y datos del usuario",
        content: { "application/json": { schema: LoginResponseSchema } },
      },
      400: { description: "Datos inválidos (ValidationError)" },
      401: { description: "Credenciales inválidas" },
    },
  });

  registerPath({
    method: "get",
    path: "/auth/me",
    tags: ["Auth"],
    summary: "Sesión actual",
    description: "Devuelve los datos del usuario autenticado por el token.",
    security: [{ bearerAuth: [] }],
    responses: {
      200: {
        description: "Usuario autenticado",
        content: { "application/json": { schema: AuthUserSchema } },
      },
      401: { description: "Token ausente, inválido o usuario inactivo" },
      404: { description: "Usuario no encontrado" },
    },
  });

  router.post("/login", asyncHandler(controller.login));
  router.get("/me", authenticate, asyncHandler(controller.me));

  return router;
};