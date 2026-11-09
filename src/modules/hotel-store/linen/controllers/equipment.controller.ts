import type { Request, Response } from "express";
import { HttpError } from "@core/middlewares/error.middleware";
import { paginatedTable, parseTableParams } from "@core/utils/table";
import type { Caller, HotelRoomsService } from "../../services/rooms.service";
import {
  HotelEquipmentDeliverDto,
  HotelEquipmentLoanCreateDto,
  HotelEquipmentReturnDto,
  HotelEquipmentUnitPatchDto,
  HotelEquipmentUnitsCreateDto,
} from "../models/dto/equipment.dto";
import type { HotelEquipmentService } from "../services/equipment.service";

const caller = (req: Request): Caller => req.user as unknown as Caller;
const str = (v: unknown) => (typeof v === "string" && v ? v : undefined);
const STATUSES = ["AVAILABLE", "LOANED", "IN_REPAIR", "MISSING", "RETIRED"] as const;

/** Equipos por pieza: inventario con etiqueta, préstamo a habitación y devolución. */
export class HotelEquipmentController {
  constructor(
    private readonly equipment: HotelEquipmentService,
    private readonly rooms: HotelRoomsService
  ) {}

  private async assertZone(req: Request, zoneId: string, permission: string) {
    const zones = await this.rooms.visibleZoneIds(caller(req), permission);
    if (zones && !zones.has(zoneId)) throw new HttpError(403, "HOTEL_ACCESS_DENIED");
  }

  createUnits = async (req: Request, res: Response) => {
    res.status(201).json(await this.equipment.createUnits(HotelEquipmentUnitsCreateDto.parse(req.body), req.user!.id));
  };

  listUnits = async (req: Request, res: Response) => {
    const status = str(req.query.status);
    if (status && !(STATUSES as readonly string[]).includes(status)) throw new HttpError(400, "INVALID_FILTER", { field: "status" });
    res.json(await this.equipment.listUnits({ status: status as (typeof STATUSES)[number] | undefined, productId: str(req.query.productId), q: str(req.query.q) }));
  };

  unitTable = async (req: Request, res: Response) => {
    const params = parseTableParams(req.body);
    const { data, total } = await this.equipment.unitTable(params);
    res.json(paginatedTable(params, data, total));
  };

  patchUnit = async (req: Request, res: Response) => {
    res.json(await this.equipment.patchUnit(req.params.id, HotelEquipmentUnitPatchDto.parse(req.body), req.user!.id));
  };

  repaired = async (req: Request, res: Response) => {
    res.json(await this.equipment.repaired(req.params.id, req.user!.id));
  };

  createLoan = async (req: Request, res: Response) => {
    const input = HotelEquipmentLoanCreateDto.parse(req.body);
    await this.assertZone(req, await this.rooms.roomZone(input.roomId), "hotel_linen.equipment_loan");
    res.status(201).json(await this.equipment.createLoan(input, req.user!.id));
  };

  deliver = async (req: Request, res: Response) => {
    const input = HotelEquipmentDeliverDto.parse(req.body ?? {});
    await this.assertZone(req, await this.equipment.zoneOfLoan(req.params.id), "hotel_linen.equipment_loan");
    res.json(await this.equipment.deliver(req.params.id, input, req.user!.id));
  };

  returnLoan = async (req: Request, res: Response) => {
    const input = HotelEquipmentReturnDto.parse(req.body);
    await this.assertZone(req, await this.equipment.zoneOfLoan(req.params.id), "hotel_linen.equipment_loan");
    res.json(await this.equipment.returnLoan(req.params.id, input, req.user!.id));
  };

  board = async (_req: Request, res: Response) => {
    res.json(await this.equipment.board());
  };
}
