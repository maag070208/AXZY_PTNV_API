import { Router } from "express";
import { asyncHandler } from "@core/utils/asyncHandler";
import { authenticate, requiresPermission } from "@core/middlewares/auth.middleware";
import type { SuppliersController } from "../controllers/suppliers.controller";

/** Catálogo general de proveedores. Cocina conserva sus rutas como alias. */
export const createSuppliersRouter = (controller: SuppliersController): Router => {
  const router = Router();
  router.use(authenticate);

  router.get("/", requiresPermission("suppliers.view"), asyncHandler(controller.list));
  router.post("/table", requiresPermission("suppliers.view"), asyncHandler(controller.table));
  router.get("/:id", requiresPermission("suppliers.view"), asyncHandler(controller.detail));
  router.post("/", requiresPermission("suppliers.manage"), asyncHandler(controller.create));
  router.patch("/:id", requiresPermission("suppliers.manage"), asyncHandler(controller.update));
  router.patch("/:id/categories", requiresPermission("suppliers.manage"), asyncHandler(controller.setCategories));

  router.get("/categories/list", requiresPermission("suppliers.view"), asyncHandler(controller.listCategories));
  router.post("/categories", requiresPermission("suppliers.manage"), asyncHandler(controller.createCategory));
  router.patch("/categories/:id", requiresPermission("suppliers.manage"), asyncHandler(controller.updateCategory));
  router.delete("/categories/:id", requiresPermission("suppliers.manage"), asyncHandler(controller.removeCategory));

  return router;
};
