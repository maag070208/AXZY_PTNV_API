import { Router } from "express";
import { authenticate, requierePermiso } from "@core/middlewares/auth.middleware";
import { asyncHandler } from "@core/utils/asyncHandler";
import { registerPath } from "@core/swagger/registry";
import {
  HorarioSchema,
  HorarioCreateDto,
  HorarioUpdateDto,
  AsignacionCreateDto,
} from "../models/dto/horario.dto";
import type { HorarioController } from "../controllers/horario.controller";

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
  router.get("/", requierePermiso("horarios.ver"), asyncHandler(controller.list));
  router.post("/", requierePermiso("horarios.administrar"), asyncHandler(controller.create));

  router.post("/asignaciones", requierePermiso("horarios.administrar"), asyncHandler(controller.asignar));
  router.post("/asignaciones/quitar", requierePermiso("horarios.administrar"), asyncHandler(controller.quitar));
  router.post("/asignaciones/query", requierePermiso("horarios.ver"), asyncHandler(controller.asignacionesTable));

  router.get("/:id/asignados", requierePermiso("horarios.ver"), asyncHandler(controller.asignados));

  // El detalle de horas extra (persona + día, con pendientes) es solo para
  // ADMIN/GERENTE. RH consume el export, que siempre devuelve solo lo aprobado.
  router.post("/horas-extra/query", requierePermiso("horas_extra.aprobar"), asyncHandler(controller.horasExtra));
  router.post("/horas-extra/export", requierePermiso("horas_extra.ver"), asyncHandler(controller.horasExtraExport));

  router.patch("/:id", requierePermiso("horarios.administrar"), asyncHandler(controller.update));
  router.delete("/:id", requierePermiso("horarios.administrar"), asyncHandler(controller.remove));

  return router;
};
