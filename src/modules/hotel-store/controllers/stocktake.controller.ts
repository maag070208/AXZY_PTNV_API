import { Request, Response } from "express";
import { HttpError } from "@core/middlewares/error.middleware";
import { scopeOf } from "@core/permissions";
import { HotelStocktakeCaptureDto, HotelStocktakeCreateDto } from "../models/dto/stocktake.dto";
import type { HotelStocktakeService } from "../services/stocktake.service";
import type { HotelWarehouseService } from "../services/warehouse.service";
import type { Caller } from "../services/rooms.service";

const caller = (req: Request): Caller => req.user as unknown as Caller;

/** Conteo de almacén o de blancos: cualquiera de los dos permisos sirve. */
const COUNT_PERMISSIONS = ["hotel_store.stocktake", "hotel_linen.count"];
/** Aprobar diferencias: el permiso de almacén o el de blancos. */
const APPROVE_PERMISSIONS = ["hotel_store.adjust_approve", "hotel_linen.count_approve"];
const approveScope = (req: Request) => {
  const scopes = APPROVE_PERMISSIONS.map((p) => scopeOf(req.user!, p));
  return scopes.includes("ALL") ? "ALL" : scopes.find((x) => x !== "NONE") ?? "NONE";
};

export class HotelStocktakeController {
  constructor(
    private readonly stocktakes: HotelStocktakeService,
    private readonly warehouses: HotelWarehouseService
  ) {}

  list = async (req: Request, res: Response) => {
    const ids = await this.warehouses.visibleWarehouseIdsAny(caller(req), COUNT_PERMISSIONS);
    res.json(await this.stocktakes.list(ids));
  };

  create = async (req: Request, res: Response) => {
    const input = HotelStocktakeCreateDto.parse(req.body);
    await this.assertVisible(req, [input.warehouseId]);
    res.status(201).json(await this.stocktakes.create(input, req.user!.id));
  };

  /** The photo is hidden from the counter while counting; only full approvers see it. */
  get = async (req: Request, res: Response) => {
    const stocktake = await this.stocktakes.get(req.params.id, true);
    await this.assertVisible(req, [stocktake.warehouseId]);
    const approver = approveScope(req) === "ALL";
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
    if (approveScope(req) === "NONE") {
      throw new HttpError(403, "INSUFFICIENT_PERMISSIONS");
    }
    const canOwn = approveScope(req) === "ALL";
    const stocktake = await this.stocktakes.get(req.params.id, true);
    await this.assertVisible(req, [stocktake.warehouseId]);
    res.json(await this.stocktakes.approve(req.params.id, req.user!.id, canOwn));
  };

  cancel = async (req: Request, res: Response) => {
    await this.guard(req);
    res.json(await this.stocktakes.cancel(req.params.id, req.user!.id));
  };

  /** Scope check on the count's warehouse before any change. */
  private async guard(req: Request): Promise<void> {
    const stocktake = await this.stocktakes.get(req.params.id, true);
    await this.assertVisible(req, [stocktake.warehouseId]);
  }

  private async assertVisible(req: Request, warehouseIds: string[]): Promise<void> {
    const visible = await this.warehouses.visibleWarehouseIdsAny(caller(req), COUNT_PERMISSIONS);
    if (visible && warehouseIds.some((id) => !visible.includes(id))) throw new HttpError(403, "HOTEL_ACCESS_DENIED");
  }
}
