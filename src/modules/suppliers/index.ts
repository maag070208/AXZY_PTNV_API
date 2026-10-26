import type { Router } from "express";
import { prismaClient } from "@core/config/database";
import type { AuditLogger } from "@modules/users/services/user.service";
import { SupplierService } from "@modules/kitchen/services/supplier.service";
import { SupplierCategoriesService } from "./services/supplier-categories.service";
import { SuppliersController } from "./controllers/suppliers.controller";
import { createSuppliersRouter } from "./routes/suppliers.routes";

/** Proveedores generales (M2.3): `/suppliers`. */
export const createSuppliersModule = (audit?: AuditLogger): Router =>
  createSuppliersRouter(
    new SuppliersController(new SupplierService(prismaClient, audit), new SupplierCategoriesService(prismaClient))
  );
