import { Router } from "express";
import { asyncHandler } from "@core/utils/asyncHandler";
import { requiresPermission } from "@core/middlewares/auth.middleware";
import type { HotelLoanController } from "../controllers/loan.controller";
import type { HotelExtraController } from "../controllers/extra.controller";
import type { HotelEquipmentController } from "../controllers/equipment.controller";

/**
 * Recepción de Blancos (F4): préstamo de toallas y corte de turno, adicionales a habitación y
 * equipos. Mounted by the hotel router under `/linen`.
 */
export const createHotelReceptionRouter = (
  loans: HotelLoanController,
  extras: HotelExtraController,
  equipment: HotelEquipmentController
): Router => {
  const router = Router();
  const view = requiresPermission("hotel_linen.view");

  // Préstamos de toallas
  router.post("/loans", requiresPermission("hotel_linen.loans"), asyncHandler(loans.create));
  router.post("/loans/table", view, asyncHandler(loans.table));
  router.get("/loans/point-summary", view, asyncHandler(loans.pointSummary));
  router.post("/loans/:folio/return", requiresPermission("hotel_linen.loans"), asyncHandler(loans.returnLoan));

  // Cortes de turno
  router.get("/shift-closes/preview", requiresPermission("hotel_linen.shift_close"), asyncHandler(loans.closePreview));
  router.post("/shift-closes/table", view, asyncHandler(loans.closeTable));
  router.post("/shift-closes", requiresPermission("hotel_linen.shift_close"), asyncHandler(loans.createClose));
  router.get("/shift-closes/:id", view, asyncHandler(loans.getClose));
  router.post("/shift-closes/:id/review", requiresPermission("hotel_linen.deposits_review"), asyncHandler(loans.reviewClose));

  // Adicionales a habitación
  router.get("/extras/board", view, asyncHandler(extras.board));
  router.post("/extras/table", view, asyncHandler(extras.table));
  router.post("/extras", requiresPermission("hotel_linen.extras_create"), asyncHandler(extras.create));
  router.post("/extras/:id/deliver", requiresPermission("hotel_linen.extras_collect"), asyncHandler(extras.deliver));
  router.post("/extras/:id/collect", requiresPermission("hotel_linen.extras_collect"), asyncHandler(extras.collect));
  router.post("/extras/:id/cancel", requiresPermission("hotel_linen.extras_create"), asyncHandler(extras.cancel));

  // Equipos por pieza
  const manage = requiresPermission("hotel_linen.equipment_manage");
  const lend = requiresPermission("hotel_linen.equipment_loan");
  router.get("/equipment/units", view, asyncHandler(equipment.listUnits));
  router.post("/equipment/units/table", view, asyncHandler(equipment.unitTable));
  router.post("/equipment/units", manage, asyncHandler(equipment.createUnits));
  router.patch("/equipment/units/:id", manage, asyncHandler(equipment.patchUnit));
  router.post("/equipment/units/:id/repaired", manage, asyncHandler(equipment.repaired));
  router.get("/equipment/board", view, asyncHandler(equipment.board));
  router.post("/equipment/loans", lend, asyncHandler(equipment.createLoan));
  router.post("/equipment/loans/:id/deliver", lend, asyncHandler(equipment.deliver));
  router.post("/equipment/loans/:id/return", lend, asyncHandler(equipment.returnLoan));

  return router;
};
