import { Router } from "express";
import { authenticate, requierePermiso } from "@core/middlewares/auth.middleware";
import { asyncHandler } from "@core/utils/asyncHandler";
import type { InventarioController } from "../controllers/inventario.controller";

export const createInventarioRouter = (controller: InventarioController): Router => {
  const router = Router();
  router.use(authenticate);

  // Tipos de dispositivo
  router.get("/tipos", asyncHandler(controller.listTipos));
  router.post("/tipos", requierePermiso("catalogos.administrar"), asyncHandler(controller.createTipo));
  router.put("/tipos/:id", requierePermiso("catalogos.administrar"), asyncHandler(controller.updateTipo));
  router.delete("/tipos/:id", requierePermiso("catalogos.administrar"), asyncHandler(controller.deleteTipo));

  // Dispositivos
  router.get("/dispositivos", asyncHandler(controller.listDispositivos));
  router.post("/dispositivos", requierePermiso("dispositivos.crear"), asyncHandler(controller.createDispositivo));
  router.get("/dispositivos/:id", asyncHandler(controller.getDispositivo));
  router.put("/dispositivos/:id", requierePermiso("dispositivos.editar"), asyncHandler(controller.updateDispositivo));
  router.delete("/dispositivos/:id", requierePermiso("dispositivos.eliminar"), asyncHandler(controller.deleteDispositivo));
  router.get("/dispositivos/:id/existencias", asyncHandler(controller.existencias));
  router.get("/dispositivos/:id/unidades", asyncHandler(controller.unidades));
  router.get("/dispositivos/:id/kardex", asyncHandler(controller.kardex));
  router.get("/unidades", asyncHandler(controller.buscarUnidades));
  router.put("/unidades-fisicas/:id", requierePermiso("dispositivos.editar"), asyncHandler(controller.updateUnidad));

  // Movimientos
  router.get("/movimientos", asyncHandler(controller.listMovimientos));
  router.get("/movimientos/:id", asyncHandler(controller.getMovimiento));
  router.post("/movimientos", requierePermiso("dispositivos.editar"), asyncHandler(controller.registerMovimiento));
  router.post("/movimientos/:id/revertir", requierePermiso("dispositivos.editar"), asyncHandler(controller.revertir));

  // Préstamos
  router.get("/prestamos", asyncHandler(controller.listPrestamos));
  router.get("/prestamos/:id", asyncHandler(controller.getPrestamo));
  router.post("/prestamos", requierePermiso("prestamos.crear"), asyncHandler(controller.createPrestamo));
  router.put("/prestamos/:id", requierePermiso("prestamos.editar"), asyncHandler(controller.updatePrestamo));
  router.post("/prestamos/:id/cancelar", requierePermiso("prestamos.eliminar"), asyncHandler(controller.cancelarPrestamo));

  // Devoluciones
  router.get("/devoluciones", asyncHandler(controller.listDevoluciones));
  router.post("/devoluciones", requierePermiso("prestamos.editar"), asyncHandler(controller.createDevolucion));

  // Dashboard
  router.get("/dashboard", asyncHandler(controller.dashboard));

  return router;
};