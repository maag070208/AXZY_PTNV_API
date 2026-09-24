import { Router } from "express";
import { authenticate, authorize } from "@core/middlewares/auth.middleware";
import { asyncHandler } from "@core/utils/asyncHandler";
import { registerPath } from "@core/swagger/registry";
import type { UserRole } from "@core/utils/security";
import {
  HorarioSchema,
  HorarioCreateDto,
  HorarioUpdateDto,
  AsignacionCreateDto,
} from "../models/dto/horario.dto";
import type { HorarioController } from "../controllers/horario.controller";

const READ_ROLES: UserRole[] = ["ADMIN", "GERENTE", "RECURSOS_HUMANOS", "JEFE_DE_AREA"];
const WRITE_ROLES: UserRole[] = ["ADMIN", "RECURSOS_HUMANOS"];

const bearer = [{ bearerAuth: [] }];

export const createHorariosRouter = (controller: HorarioController): Router => {
  const router = Router();

  registerPath({
    method: "get",
    path: "/horarios",
    tags: ["Horarios"],
    summary: "Listar horarios",
    security: bearer,
    parameters: [{ in: "query", name: "includeInactive", required: false, schema: { type: "boolean" } }],
    responses: { 200: { description: "Horarios", content: { "application/json": { schema: HorarioSchema.array() } } } },
  });

  registerPath({
    method: "post",
    path: "/horarios",
    tags: ["Horarios"],
    summary: "Crear horario",
    security: bearer,
    request: { body: { required: true, content: { "application/json": { schema: HorarioCreateDto } } } },
    responses: { 201: { description: "Creado", content: { "application/json": { schema: HorarioSchema } } } },
  });

  registerPath({
    method: "patch",
    path: "/horarios/{id}",
    tags: ["Horarios"],
    summary: "Actualizar horario",
    security: bearer,
    parameters: [{ in: "path", name: "id", required: true, schema: { type: "string" } }],
    request: { body: { required: true, content: { "application/json": { schema: HorarioUpdateDto } } } },
    responses: { 200: { description: "Actualizado", content: { "application/json": { schema: HorarioSchema } } } },
  });

  registerPath({
    method: "delete",
    path: "/horarios/{id}",
    tags: ["Horarios"],
    summary: "Desactivar/eliminar horario",
    security: bearer,
    parameters: [{ in: "path", name: "id", required: true, schema: { type: "string" } }],
    responses: { 200: { description: "Resultado" } },
  });

  registerPath({
    method: "post",
    path: "/horarios/asignaciones",
    tags: ["Horarios"],
    summary: "Asignación masiva de un horario a varias personas",
    security: bearer,
    request: { body: { required: true, content: { "application/json": { schema: AsignacionCreateDto } } } },
    responses: { 201: { description: "Asignados" } },
  });

  router.use(authenticate);

  // Catálogo (catálogos primero para no colisionar con rutas hijas).
  router.get("/", authorize(READ_ROLES), asyncHandler(controller.list));
  router.post("/", authorize(WRITE_ROLES), asyncHandler(controller.create));

  router.post("/asignaciones", authorize(WRITE_ROLES), asyncHandler(controller.asignar));
  router.post("/asignaciones/quitar", authorize(WRITE_ROLES), asyncHandler(controller.quitar));
  router.post("/asignaciones/query", authorize(READ_ROLES), asyncHandler(controller.asignacionesTable));

  router.get("/:id/asignados", authorize(READ_ROLES), asyncHandler(controller.asignados));

  router.post("/horas-extra/query", authorize(READ_ROLES), asyncHandler(controller.horasExtra));
  router.post("/horas-extra/export", authorize(READ_ROLES), asyncHandler(controller.horasExtraExport));

  router.patch("/:id", authorize(WRITE_ROLES), asyncHandler(controller.update));
  router.delete("/:id", authorize(WRITE_ROLES), asyncHandler(controller.remove));

  return router;
};
