import type { Request, Response } from "express";
import { paginatedTable, parseTableParams } from "@core/utils/table";
import type { HotelWarehouseService } from "../../services/warehouse.service";
import type { Caller } from "../../services/rooms.service";
import { HotelTransferSignoffDto } from "../models/dto/signoff.dto";
import type { HotelTransferSignoffService } from "../services/signoff.service";

const caller = (req: Request): Caller => req.user as unknown as Caller;
const PERMISSION = "hotel_linen.transfer_signoff";

/** 2ª firma en limpio a área: bandeja y conformidad / diferencia. */
export class HotelTransferSignoffController {
  constructor(
    private readonly signoffs: HotelTransferSignoffService,
    private readonly warehouses: HotelWarehouseService
  ) {}

  sign = async (req: Request, res: Response) => {
    const input = HotelTransferSignoffDto.parse(req.body);
    await this.warehouses.assertWarehousesVisible(caller(req), [await this.signoffs.destinationOf(req.params.id)], PERMISSION);
    res.json(await this.signoffs.sign(req.params.id, input, req.user!.id));
  };

  table = async (req: Request, res: Response) => {
    const params = parseTableParams(req.body);
    const visible = await this.warehouses.visibleWarehouseIds(caller(req), PERMISSION);
    const { data, total } = await this.signoffs.table(params, visible);
    res.json(paginatedTable(params, data, total));
  };
}
