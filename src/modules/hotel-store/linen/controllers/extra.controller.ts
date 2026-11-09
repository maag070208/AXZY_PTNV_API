import type { Request, Response } from "express";
import { HttpError } from "@core/middlewares/error.middleware";
import { paginatedTable, parseTableParams } from "@core/utils/table";
import type { HotelWarehouseService } from "../../services/warehouse.service";
import type { Caller, HotelRoomsService } from "../../services/rooms.service";
import { HotelExtraCollectDto, HotelExtraCreateDto, HotelExtraDeliverDto } from "../models/dto/extra.dto";
import type { HotelExtraService } from "../services/extra.service";

const caller = (req: Request): Caller => req.user as unknown as Caller;

/** Adicionales a habitación: Recepción los solicita, la supervisora/auxiliar de piso los entrega y recolecta. */
export class HotelExtraController {
  constructor(
    private readonly extras: HotelExtraService,
    private readonly warehouses: HotelWarehouseService,
    private readonly rooms: HotelRoomsService
  ) {}

  /** 403 si la zona queda fuera del alcance del permiso. */
  private async assertZone(req: Request, zoneId: string, permission: string) {
    const zones = await this.rooms.visibleZoneIds(caller(req), permission);
    if (zones && !zones.has(zoneId)) throw new HttpError(403, "HOTEL_ACCESS_DENIED");
  }

  create = async (req: Request, res: Response) => {
    const input = HotelExtraCreateDto.parse(req.body);
    const source = await this.extras.sourcePoint(input.warehouseId);
    await this.warehouses.assertWarehousesVisible(caller(req), [source.id], "hotel_linen.extras_create");
    res.status(201).json(await this.extras.create(input, req.user!.id, source));
  };

  deliver = async (req: Request, res: Response) => {
    const input = HotelExtraDeliverDto.parse(req.body ?? {});
    await this.assertZone(req, await this.extras.zoneOf(req.params.id), "hotel_linen.extras_collect");
    res.json(await this.extras.deliver(req.params.id, input, req.user!.id));
  };

  collect = async (req: Request, res: Response) => {
    const input = HotelExtraCollectDto.parse(req.body);
    await this.assertZone(req, await this.extras.zoneOf(req.params.id), "hotel_linen.extras_collect");
    res.json(await this.extras.collect(req.params.id, input, req.user!.id));
  };

  cancel = async (req: Request, res: Response) => {
    res.json(await this.extras.cancel(req.params.id, req.user!.id));
  };

  board = async (req: Request, res: Response) => {
    const zones = await this.rooms.visibleZoneIdsAny(caller(req), ["hotel_linen.extras_collect", "hotel_linen.extras_create"]);
    res.json(await this.extras.board(zones));
  };

  table = async (req: Request, res: Response) => {
    const params = parseTableParams(req.body);
    const zones = await this.rooms.visibleZoneIdsAny(caller(req), ["hotel_linen.extras_collect", "hotel_linen.extras_create", "hotel_linen.view"]);
    const { data, total } = await this.extras.table(params, zones);
    res.json(paginatedTable(params, data, total));
  };
}
