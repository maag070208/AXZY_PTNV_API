import type { Request, Response } from "express";
import { scopeOf } from "@core/permissions";
import type { HotelWarehouseService } from "../../services/warehouse.service";
import type { Caller } from "../../services/rooms.service";
import type { HotelLinenReportService } from "../services/report.service";

const caller = (req: Request): Caller => req.user as unknown as Caller;
const str = (v: unknown): string | undefined => (typeof v === "string" && v ? v : undefined);

/** Reportes y tablero de blancos (F7). */
export class HotelLinenReportController {
  constructor(
    private readonly reports: HotelLinenReportService,
    private readonly warehouses: HotelWarehouseService
  ) {}

  /** Contadores del tablero: solo los de los permisos que el usuario tiene, con sus almacenes visibles. */
  dashboard = async (req: Request, res: Response) => {
    const user = req.user!;
    const has = (permission: string) => scopeOf(user, permission) !== "NONE";
    const visibleIds = await this.warehouses.visibleWarehouseIds(caller(req), "hotel_linen.view");
    const receivableIds = await this.warehouses.visibleWarehouseIds(caller(req), "hotel_linen.transfer_receive");
    res.json(
      await this.reports.dashboard({
        visibleIds,
        receivableIds,
        can: {
          transfers: has("hotel_linen.view"),
          writeoffReview: has("hotel_linen.writeoff_review"),
          writeoffApprove: has("hotel_linen.writeoff_approve"),
          reconciliation: has("hotel_linen.dirty_receive") || has("hotel_linen.process") || has("hotel_linen.reports"),
          loans: has("hotel_linen.loans") || has("hotel_linen.shift_close") || has("hotel_linen.deposits_review") || has("hotel_linen.reports"),
          extras: has("hotel_linen.extras_create") || has("hotel_linen.extras_collect") || has("hotel_linen.reports"),
          equipment: has("hotel_linen.equipment_manage") || has("hotel_linen.equipment_loan") || has("hotel_linen.reports"),
          requests: has("hotel_linen.request") || has("hotel_linen.fulfill"),
          purchase: has("hotel_purchase.view"),
          purchaseApprove: has("hotel_purchase.approve"),
        },
      })
    );
  };

  par = async (req: Request, res: Response) => {
    res.json(await this.reports.par(str(req.query.kind)));
  };

  condition = async (req: Request, res: Response) => {
    res.json(await this.reports.condition(str(req.query.warehouseId)));
  };

  shrinkage = async (req: Request, res: Response) => {
    res.json(await this.reports.shrinkage(str(req.query.from), str(req.query.to)));
  };

  laundry = async (req: Request, res: Response) => {
    res.json(await this.reports.laundry(str(req.query.from), str(req.query.to)));
  };

  areaReconciliation = async (req: Request, res: Response) => {
    res.json(await this.reports.areaReconciliation(str(req.query.from), str(req.query.to)));
  };

  kardex = async (req: Request, res: Response) => {
    res.json(await this.reports.kardex(str(req.query.productId), str(req.query.from), str(req.query.to), str(req.query.warehouseId)));
  };
}
