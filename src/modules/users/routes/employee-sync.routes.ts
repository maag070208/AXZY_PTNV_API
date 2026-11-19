import { Router } from "express";
import multer from "multer";
import {
  authenticate,
  requiresAnyPermission,
  requiresPermission,
} from "@core/middlewares/auth.middleware";
import { asyncHandler } from "@core/utils/asyncHandler";
import { registerPath } from "@core/swagger/registry";
import { EmployeeSyncConfirmDto, EmployeeSyncExportDto } from "../models/dto/employee-sync.dto";
import type { EmployeeSyncController } from "../controllers/employee-sync.controller";

/**
 * Sincronización de empleados desde el Excel de nómina.
 *
 * Router propio montado TAMBIÉN en `/users` (después del `userRouter`): sus
 * rutas `POST /sync/...` no colisionan con las del CRUD de usuarios. Lleva su
 * propio `authenticate` para no depender del orden de montaje, igual que el
 * resto de los routers del módulo.
 */
export const createEmployeeSyncRouter = (
  controller: EmployeeSyncController
): Router => {
  const router = Router();

  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 },
  });

  registerPath({
    method: "post",
    path: "/users/sync/preview",
    tags: ["Users"],
    summary: "Preview the payroll Excel sync (does not write anything)",
    security: [{ bearerAuth: [] }],
    request: {
      body: {
        required: true,
        content: {
          "multipart/form-data": {
            schema: {
              type: "object",
              properties: { file: { type: "string", format: "binary" } },
            },
          },
        },
      },
    },
    responses: {
      200: { description: "Altas, bajas, coincidencias, cambios y pendientes por resolver" },
      400: { description: "Falta el archivo, la hoja o el archivo está vacío" },
    },
  });

  registerPath({
    method: "post",
    path: "/users/sync/confirm",
    tags: ["Users"],
    summary: "Apply the reviewed payroll sync (all or nothing)",
    security: [{ bearerAuth: [] }],
    request: {
      body: {
        required: true,
        content: { "application/json": { schema: EmployeeSyncConfirmDto } },
      },
    },
    responses: {
      200: { description: "Created, deactivated and updated people plus clock results" },
      422: { description: "Rows to fix; nothing was applied" },
    },
  });

  registerPath({
    method: "post",
    path: "/users/sync/export",
    tags: ["Users"],
    summary: "Export the reviewed sync report as Excel",
    security: [{ bearerAuth: [] }],
    request: {
      body: {
        required: true,
        content: { "application/json": { schema: EmployeeSyncExportDto } },
      },
    },
    responses: {
      200: {
        description: "Excel report",
        content: {
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": {
            schema: { type: "string", format: "binary" },
          },
        },
      },
    },
  });

  router.use(authenticate);

  router.post(
    "/sync/preview",
    requiresAnyPermission(["users.create", "users.edit"]),
    upload.single("file"),
    asyncHandler(controller.preview)
  );
  // Crear y dar de baja en la misma operación: se exigen AMBOS permisos.
  router.post(
    "/sync/confirm",
    requiresPermission("users.create"),
    requiresPermission("users.edit"),
    asyncHandler(controller.confirm)
  );
  router.post(
    "/sync/export",
    requiresAnyPermission(["users.create", "users.edit"]),
    asyncHandler(controller.export)
  );

  return router;
};
