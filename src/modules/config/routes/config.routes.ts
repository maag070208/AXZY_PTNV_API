import { Router } from "express";
import { authenticate, requiresPermission } from "@core/middlewares/auth.middleware";
import { asyncHandler } from "@core/utils/asyncHandler";
import { registerPath } from "@core/swagger/registry";
import type { SysConfigController } from "../controllers/sys-config.controller";

const bearer = [{ bearerAuth: [] }];

export const createConfigRoutes = (controller: SysConfigController): Router => {
  const router = Router();

  registerPath({
    method: "get",
    path: "/sys-config",
    tags: ["SysConfig"],
    summary: "List all system settings (ADMIN)",
    security: bearer,
    responses: {
      200: {
        description: "Settings list",
        content: {
          "application/json": {
            schema: { type: "array", items: { type: "object" } },
          },
        },
      },
    },
  });

  registerPath({
    method: "get",
    path: "/sys-config/{key}",
    tags: ["SysConfig"],
    summary: "Get setting by key",
    security: bearer,
    parameters: [
      { in: "path", name: "key", required: true, schema: { type: "string" } },
    ],
    responses: {
      200: { description: "Setting", content: { "application/json": { schema: { type: "object" } } } },
      404: { description: "No encontrada" },
    },
  });

  registerPath({
    method: "put",
    path: "/sys-config/{key}",
    tags: ["SysConfig"],
    summary: "Create/update setting (ADMIN)",
    security: bearer,
    parameters: [
      { in: "path", name: "key", required: true, schema: { type: "string" } },
    ],
    request: {
      body: {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              required: ["value"],
              properties: {
                value: { type: "string" },
                description: { type: "string" },
              },
            },
          },
        },
      },
    },
    responses: {
      200: { description: "Setting saved", content: { "application/json": { schema: { type: "object" } } } },
      400: { description: "Invalid body or malformed key" },
    },
  });

  registerPath({
    method: "delete",
    path: "/sys-config/{key}",
    tags: ["SysConfig"],
    summary: "Delete setting (ADMIN)",
    security: bearer,
    parameters: [
      { in: "path", name: "key", required: true, schema: { type: "string" } },
    ],
    responses: {
      204: { description: "Eliminada" },
      404: { description: "No encontrada" },
    },
  });

  router.use(authenticate);
  router.get("/", requiresPermission("system.configure"), asyncHandler(controller.list));
  router.get("/:key", asyncHandler(controller.getOne));
  router.put("/:key", requiresPermission("system.configure"), asyncHandler(controller.upsert));
  router.delete("/:key", requiresPermission("system.configure"), asyncHandler(controller.remove));

  return router;
};