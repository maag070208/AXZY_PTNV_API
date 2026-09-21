import { Router } from "express";
import { authenticate, authorize } from "@core/middlewares/auth.middleware";
import { asyncHandler } from "@core/utils/asyncHandler";
import type { UserRole } from "@core/utils/security";
import type { InventarioController } from "../controllers/inventario.controller";

const canManage: UserRole[] = ["ADMIN", "GERENTE", "JEFE_DE_AREA"];

export const createInventarioRouter = (controller: InventarioController): Router => {
  const router = Router();
  router.use(authenticate);

  // Tipos de dispositivo
  router.get("/tipos", asyncHandler(controller.listTipos));
  router.post("/tipos", authorize(canManage), asyncHandler(controller.createTipo));
  router.put("/tipos/:id", authorize(canManage), asyncHandler(controller.updateTipo));
  router.delete("/tipos/:id", authorize(canManage), asyncHandler(controller.deleteTipo));

  // Dispositivos
  router.get("/dispositivos", asyncHandler(controller.listDispositivos));
  router.post("/dispositivos", authorize(canManage), asyncHandler(controller.createDispositivo));
  router.get("/dispositivos/:id", asyncHandler(controller.getDispositivo));
  router.put("/dispositivos/:id", authorize(canManage), asyncHandler(controller.updateDispositivo));
  router.delete("/dispositivos/:id", authorize(canManage), asyncHandler(controller.deleteDispositivo));
  router.get("/dispositivos/:id/existencias", asyncHandler(controller.existencias));
  router.get("/dispositivos/:id/unidades", asyncHandler(controller.unidades));
  router.get("/dispositivos/:id/kardex", asyncHandler(controller.kardex));
  router.put("/unidades-fisicas/:id", authorize(canManage), asyncHandler(controller.updateUnidad));

  // Movimientos
  router.get("/movimientos", asyncHandler(controller.listMovimientos));
  router.get("/movimientos/:id", asyncHandler(controller.getMovimiento));
  router.post("/movimientos", authorize(canManage), asyncHandler(controller.registerMovimiento));
  router.post("/movimientos/:id/revertir", authorize(canManage), asyncHandler(controller.revertir));

  // Préstamos
  router.get("/prestamos", asyncHandler(controller.listPrestamos));
  router.get("/prestamos/:id", asyncHandler(controller.getPrestamo));
  router.post("/prestamos", authorize(canManage), asyncHandler(controller.createPrestamo));
  router.put("/prestamos/:id", authorize(canManage), asyncHandler(controller.updatePrestamo));
  router.post("/prestamos/:id/cancelar", authorize(canManage), asyncHandler(controller.cancelarPrestamo));

  // Devoluciones
  router.get("/devoluciones", asyncHandler(controller.listDevoluciones));
  router.post("/devoluciones", authorize(canManage), asyncHandler(controller.createDevolucion));

  // Dashboard
  router.get("/dashboard", asyncHandler(controller.dashboard));

  return router;
};