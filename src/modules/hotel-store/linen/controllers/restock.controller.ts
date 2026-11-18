import type { Request, Response } from "express";
import { HttpError } from "@core/middlewares/error.middleware";
import type { HotelWarehouseService } from "../../services/warehouse.service";
import type { Caller } from "../../services/rooms.service";
import { HotelRestockRequestDto } from "../models/dto/restock.dto";
import { parseRestockFactor } from "../services/restock-rules";
import type { HotelRestockService } from "../services/restock.service";
import type { HotelLinenFlowService } from "../services/flow.service";

const caller = (req: Request): Caller => req.user as unknown as Caller;
const str = (v: unknown): string | undefined => (typeof v === "string" && v ? v : undefined);

/** Reposición por dotación y tablero de flujo de blancos. */
export class HotelRestockController {
  constructor(
    private readonly restock: HotelRestockService,
    private readonly flow: HotelLinenFlowService,
    private readonly warehouses: HotelWarehouseService
  ) {}

  compute = async (req: Request, res: Response) => {
    const warehouseId = str(req.query.warehouseId);
    if (!warehouseId) throw new HttpError(400, "INVALID_FILTER", { field: "warehouseId" });
    const factor = parseRestockFactor(req.query.factor);
    if (factor === null) throw new HttpError(400, "HOTEL_RESTOCK_FACTOR_INVALID");
    await this.warehouses.assertWarehousesVisible(caller(req), [warehouseId], "hotel_linen.request");
    res.json(await this.restock.compute(warehouseId, factor));
  };

  createRequest = async (req: Request, res: Response) => {
    const input = HotelRestockRequestDto.parse(req.body);
    const factor = parseRestockFactor(input.factor);
    if (factor === null) throw new HttpError(400, "HOTEL_RESTOCK_FACTOR_INVALID");
    await this.warehouses.assertWarehousesVisible(caller(req), [input.warehouseId], "hotel_linen.request");
    res.status(201).json(await this.restock.request(input.warehouseId, factor, req.user!.id));
  };

  /** Alcance total sobre `hotel_linen.view` (gerencia, supervisora general, almacén, compras): ve todos los almacenes. */
  board = async (req: Request, res: Response) => {
    const visible = await this.warehouses.visibleWarehouseIds(caller(req), "hotel_linen.view");
    if (visible) throw new HttpError(403, "HOTEL_FLOW_ALL_SCOPE_REQUIRED");
    res.json(await this.flow.board(str(req.query.kind) ?? "LINEN"));
  };
}
