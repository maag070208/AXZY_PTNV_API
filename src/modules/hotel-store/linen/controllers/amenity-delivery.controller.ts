import type { Request, Response } from "express";
import { HttpError } from "@core/middlewares/error.middleware";
import { paginatedTable, parseTableParams } from "@core/utils/table";
import type { HotelWarehouseService } from "../../services/warehouse.service";
import type { Caller } from "../../services/rooms.service";
import { HotelAmenityDeliveryCreateDto } from "../models/dto/amenity-delivery.dto";
import type { HotelAmenityDeliveryService } from "../services/amenity-delivery.service";

const caller = (req: Request): Caller => req.user as unknown as Caller;
const PERMISSION = "hotel_linen.amenity_delivery";
const str = (v: unknown) => (typeof v === "string" && v ? v : undefined);

/** Entrega de amenidades: Almacén -> ropería con destinataria supervisora. */
export class HotelAmenityDeliveryController {
  constructor(
    private readonly deliveries: HotelAmenityDeliveryService,
    private readonly warehouses: HotelWarehouseService
  ) {}

  private requireWarehouse = (req: Request): string => {
    const warehouseId = str(req.query.warehouseId);
    if (!warehouseId) throw new HttpError(400, "INVALID_FILTER", { field: "warehouseId" });
    return warehouseId;
  };

  create = async (req: Request, res: Response) => {
    const input = HotelAmenityDeliveryCreateDto.parse(req.body);
    await this.warehouses.assertWarehousesVisible(caller(req), [input.fromWarehouseId, input.toWarehouseId], PERMISSION);
    res.status(201).json(await this.deliveries.create(input, req.user!.id, req.header("Idempotency-Key") ?? null));
  };

  table = async (req: Request, res: Response) => {
    const params = parseTableParams(req.body);
    const { data, total } = await this.deliveries.table(params);
    res.json(paginatedTable(params, data, total));
  };

  suggestion = async (req: Request, res: Response) => {
    res.json(await this.deliveries.suggestion(this.requireWarehouse(req)));
  };

  recipients = async (req: Request, res: Response) => {
    res.json(await this.deliveries.recipients(this.requireWarehouse(req)));
  };

  history = async (req: Request, res: Response) => {
    res.json(await this.deliveries.history(this.requireWarehouse(req)));
  };

  get = async (req: Request, res: Response) => {
    res.json(await this.deliveries.get(req.params.id));
  };
}
