import { Request, Response } from "express";
import { HttpError } from "@core/middlewares/error.middleware";
import { scopeOf } from "@core/permissions";
import { HotelStocktakeCaptureDto, HotelStocktakeCreateDto } from "../models/dto/stocktake.dto";
import type { HotelStocktakeService } from "../services/stocktake.service";
import type { HotelWarehouseService } from "../services/warehouse.service";
import type { Caller } from "../services/rooms.service";

const caller = (req: Request): Caller => req.user as unknown as Caller;

export class HotelStocktakeController {
  constructor(
    private readonly stocktakes: HotelStocktakeService,
    private readonly warehouses: HotelWarehouseService
  ) {}

  list = async (req: Request, res: Response) => {
    const ids = await this.warehouses.visibleWarehouseIds(caller(req), "hotel_store.stocktake");
    res.json(await this.stocktakes.list(ids));
  };

  create = async (req: Request, res: Response) => {
    const input = HotelStocktakeCreateDto.parse(req.body);
    await this.warehouses.assertWarehousesVisible(caller(req), [input.warehouseId], "hotel_store.stocktake");
    res.status(201).json(await this.stocktakes.create(input, req.user!.id));
  };

  /** The photo is hidden from the counter while counting; only full approvers see it. */
  get = async (req: Request, res: Response) => {
    const stocktake = await this.stocktakes.get(req.params.id, true);
    await this.warehouses.assertWarehousesVisible(caller(req), [stocktake.warehouseId], "hotel_store.stocktake");
    const approver = scopeOf(req.user!, "hotel_store.adjust_approve") === "ALL";
    const hidePhoto = stocktake.blind && stocktake.status === "COUNTING" && !approver;
    res.json(hidePhoto ? await this.stocktakes.get(req.params.id, false) : stocktake);
  };

  start = async (req: Request, res: Response) => {
    await this.guard(req);
    res.json(await this.stocktakes.start(req.params.id, req.user!.id));
  };

  capture = async (req: Request, res: Response) => {
    await this.guard(req);
    const { lines } = HotelStocktakeCaptureDto.parse(req.body);
    res.json(await this.stocktakes.capture(req.params.id, lines, req.user!.id));
  };

  close = async (req: Request, res: Response) => {
    await this.guard(req);
    res.json(await this.stocktakes.close(req.params.id, req.user!.id));
  };

  approve = async (req: Request, res: Response) => {
    if (scopeOf(req.user!, "hotel_store.adjust_approve") === "NONE") {
      throw new HttpError(403, "INSUFFICIENT_PERMISSIONS");
    }
    const canOwn = scopeOf(req.user!, "hotel_store.adjust_approve") === "ALL";
    const stocktake = await this.stocktakes.get(req.params.id, true);
    await this.warehouses.assertWarehousesVisible(caller(req), [stocktake.warehouseId], "hotel_store.stocktake");
    res.json(await this.stocktakes.approve(req.params.id, req.user!.id, canOwn));
  };

  cancel = async (req: Request, res: Response) => {
    await this.guard(req);
    res.json(await this.stocktakes.cancel(req.params.id, req.user!.id));
  };

  /** Scope check on the count's warehouse before any change. */
  private async guard(req: Request): Promise<void> {
    const stocktake = await this.stocktakes.get(req.params.id, true);
    await this.warehouses.assertWarehousesVisible(caller(req), [stocktake.warehouseId], "hotel_store.stocktake");
  }
}
