import { Request, Response } from "express";
import { HttpError } from "@core/middlewares/error.middleware";
import { scopeOf } from "@core/permissions";
import {
  HotelLocationCreateDto,
  HotelMovementCreateDto,
  HotelWarehouseCreateDto,
  HotelWarehouseUpdateDto,
} from "../models/dto/store.dto";
import type { HotelMovementService } from "../services/movement.service";
import type { HotelWarehouseService } from "../services/warehouse.service";
import type { HotelStockService } from "../services/stock.service";
import type { Caller } from "../services/rooms.service";
import type { HotelMovementType } from "../services/kardex-rules";

/** Permission each movement type needs (plan 10). */
const PERMISSION_BY_TYPE: Record<HotelMovementType, string> = {
  INITIAL_LOAD: "hotel_store.stock_in",
  INBOUND: "hotel_store.stock_in",
  TRANSFER: "hotel_store.transfer",
  ROOM_CONSUMPTION: "hotel_store.stock_out",
  LINEN_EXCHANGE: "hotel_store.transfer",
  ADJUST_IN: "hotel_store.adjust",
  ADJUST_OUT: "hotel_store.adjust",
  WRITE_OFF: "hotel_store.stock_out",
};

const caller = (req: Request): Caller => req.user as unknown as Caller;

const requireType = (req: Request, type: HotelMovementType): void => {
  if (scopeOf(req.user!, PERMISSION_BY_TYPE[type]) === "NONE") {
    throw new HttpError(403, "INSUFFICIENT_PERMISSIONS");
  }
};

export class HotelStoreController {
  constructor(
    private readonly warehouses: HotelWarehouseService,
    private readonly movements: HotelMovementService,
    private readonly stock: HotelStockService
  ) {}

  listWarehouses = async (req: Request, res: Response) => {
    const ids = await this.warehouses.visibleWarehouseIds(caller(req), "hotel_store.view");
    res.json(await this.warehouses.list(req.query.includeInactive === "true", ids));
  };
  createWarehouse = async (req: Request, res: Response) => {
    res.status(201).json(await this.warehouses.create(HotelWarehouseCreateDto.parse(req.body)));
  };
  updateWarehouse = async (req: Request, res: Response) => {
    res.json(await this.warehouses.update(req.params.id, HotelWarehouseUpdateDto.parse(req.body)));
  };
  removeWarehouse = async (req: Request, res: Response) => {
    res.json(await this.warehouses.remove(req.params.id));
  };
  addLocation = async (req: Request, res: Response) => {
    res.status(201).json(await this.warehouses.addLocation(req.params.id, HotelLocationCreateDto.parse(req.body)));
  };

  stockRows = async (req: Request, res: Response) => {
    const ids = await this.warehouses.visibleWarehouseIds(caller(req), "hotel_store.view");
    res.json(await this.stock.rows(ids));
  };
  reconcile = async (req: Request, res: Response) => {
    const ids = await this.warehouses.visibleWarehouseIds(caller(req), "hotel_store.view");
    res.json(await this.stock.reconcile(ids));
  };

  listMovements = async (req: Request, res: Response) => {
    const ids = await this.warehouses.visibleWarehouseIds(caller(req), "hotel_store.view");
    res.json(await this.movements.list({ visibleWarehouseIds: ids }));
  };
  getMovement = async (req: Request, res: Response) => {
    const movement = await this.movements.get(req.params.id);
    await this.warehouses.assertWarehousesVisible(
      caller(req),
      [movement.fromWarehouseId, movement.warehouseId],
      "hotel_store.view"
    );
    res.json(movement);
  };
  postMovement = async (req: Request, res: Response) => {
    const input = HotelMovementCreateDto.parse(req.body);
    requireType(req, input.type);
    await this.warehouses.assertWarehousesVisible(
      caller(req),
      [input.fromWarehouseId, input.warehouseId],
      PERMISSION_BY_TYPE[input.type]
    );
    const key = req.header("Idempotency-Key") ?? null;
    res.status(201).json(await this.movements.post(input, req.user!.id, key));
  };
  cancelMovement = async (req: Request, res: Response) => {
    const movement = await this.movements.get(req.params.id);
    requireType(req, movement.type as HotelMovementType);
    await this.warehouses.assertWarehousesVisible(
      caller(req),
      [movement.fromWarehouseId, movement.warehouseId],
      PERMISSION_BY_TYPE[movement.type as HotelMovementType]
    );
    res.json(await this.movements.cancel(req.params.id, req.user!.id));
  };
}

