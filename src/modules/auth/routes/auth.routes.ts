import { Router } from "express";
import { authenticate } from "@core/middlewares/auth.middleware";
import { asyncHandler } from "@core/utils/asyncHandler";
import { registerPath } from "@core/swagger/registry";
import { LoginInputSchema, LoginResponseSchema, AuthMeSchema, RefreshInputSchema, RefreshResponseSchema } from "../models/dto/auth.dto";
import type { AuthController } from "../controllers/auth.controller";

export const createAuthRouter = (controller: AuthController): Router => {
  const router = Router();

  registerPath({
    method: "post",
    path: "/auth/login",
    tags: ["Auth"],
    summary: "Sign in",
    description: "Validates credentials and returns a JWT token.",
    request: {
      body: {
        required: true,
        content: { "application/json": { schema: LoginInputSchema } },
      },
    },
    responses: {
      200: {
        description: "Token and user data",
        content: { "application/json": { schema: LoginResponseSchema } },
      },
      400: { description: "Invalid data (ValidationError)" },
      401: { description: "Invalid credentials" },
    },
  });

  registerPath({
    method: "get",
    path: "/auth/me",
    tags: ["Auth"],
    summary: "Current session",
    description:
      "Returns the data of the user authenticated by the token, including their digital badge data (number, job title, department and photo).",
    security: [{ bearerAuth: [] }],
    responses: {
      200: {
        description: "Authenticated user",
        content: { "application/json": { schema: AuthMeSchema } },
      },
      401: { description: "Missing or invalid token, or inactive user" },
      404: { description: "User not found" },
    },
  });

  registerPath({
    method: "post",
    path: "/auth/refresh",
    tags: ["Auth"],
    summary: "Refresh access token",
    description: "Exchanges a valid refresh token for a new access token and a rotated refresh token.",
    request: {
      body: { required: true, content: { "application/json": { schema: RefreshInputSchema } } },
    },
    responses: {
      200: { description: "New tokens", content: { "application/json": { schema: RefreshResponseSchema } } },
      401: { description: "Invalid or expired refresh token" },
    },
  });

  router.post("/login", asyncHandler(controller.login));
  router.post("/refresh", asyncHandler(controller.refresh));
  router.get("/me", authenticate, asyncHandler(controller.me));

  return router;
};