import type { Request, Response } from "express";
import { HttpError } from "@core/middlewares/error.middleware";
import { paginatedTable, parseTableParams } from "@core/utils/table";
import type { HotelWarehouseService } from "../../services/warehouse.service";
import type { Caller } from "../../services/rooms.service";
import { HotelAmenityControlSaveDto } from "../models/dto/amenity.dto";
import type { HotelAmenityService } from "../services/amenity.service";

const caller = (req: Request): Caller => req.user as unknown as Caller;
const str = (v: unknown) => (typeof v === "string" && v ? v : undefined);
const actor = (req: Request) => ({ id: req.user!.id, roles: (req.user as unknown as { roles?: string[] }).roles });

/** Control semanal de amenidades, bodega bajo mínimo y toallas del Spa. */
export class HotelAmenityController {
  constructor(private readonly amenities: HotelAmenityService, private readonly warehouses: HotelWarehouseService) {}

  preview = async (req: Request, res: Response) => {
    const warehouseId = str(req.query.warehouseId);
    const weekFrom = str(req.query.weekFrom);
    if (!warehouseId) throw new HttpError(400, "INVALID_FILTER", { field: "warehouseId" });
    if (!weekFrom) throw new HttpError(400, "INVALID_FILTER", { field: "weekFrom" });
    await this.warehouses.assertWarehousesVisible(caller(req), [warehouseId], "hotel_linen.amenities_control");
    res.json(await this.amenities.preview(warehouseId, weekFrom));
  };

  save = async (req: Request, res: Response) => {
    const input = HotelAmenityControlSaveDto.parse(req.body);
    await this.warehouses.assertWarehousesVisible(caller(req), [input.warehouseId], "hotel_linen.amenities_control");
    res.status(201).json(await this.amenities.saveDraft(input, req.user!.id));
  };

  submit = async (req: Request, res: Response) => {
    await this.assertVisible(req);
    res.json(await this.amenities.submit(req.params.id, req.user!.id));
  };

  review = async (req: Request, res: Response) => {
    await this.assertVisible(req);
    res.json(await this.amenities.review(req.params.id, actor(req)));
  };

  acknowledge = async (req: Request, res: Response) => {
    await this.assertVisible(req, "hotel_linen.reports");
    res.json(await this.amenities.acknowledge(req.params.id, actor(req)));
  };

  table = async (req: Request, res: Response) => {
    const params = parseTableParams(req.body);
    const visible = await this.warehouses.visibleWarehouseIds(caller(req), "hotel_linen.view");
    const { data, total } = await this.amenities.table(params, visible);
    res.json(paginatedTable(params, data, total));
  };

  get = async (req: Request, res: Response) => {
    await this.assertVisible(req, "hotel_linen.view");
    res.json(await this.amenities.get(req.params.id));
  };

  lowStock = async (_req: Request, res: Response) => {
    res.json(await this.amenities.amenityLowStock());
  };

  spaDaily = async (req: Request, res: Response) => {
    res.json(await this.amenities.spaDaily(str(req.query.date)));
  };

  private async assertVisible(req: Request, permission = "hotel_linen.amenities_control") {
    const header = await this.amenities.header(req.params.id);
    await this.warehouses.assertWarehousesVisible(caller(req), [header.warehouseId], permission);
  }
}
