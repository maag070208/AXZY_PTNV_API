import type { Request, Response } from "express";
import { HttpError } from "@core/middlewares/error.middleware";
import { paginatedTable, parseTableParams } from "@core/utils/table";
import type { Caller, HotelRoomsService } from "../../services/rooms.service";
import { HotelRoomReviewCreateDto } from "../models/dto/room-review.dto";
import type { HotelRoomReviewService } from "../services/room-review.service";

const caller = (req: Request): Caller => req.user as unknown as Caller;
const PERMISSION = "hotel_linen.room_review";

/** Revisión de habitación: la supervisora (o gerencia) cuenta los blancos contra la dotación. */
export class HotelRoomReviewController {
  constructor(
    private readonly reviews: HotelRoomReviewService,
    private readonly rooms: HotelRoomsService
  ) {}

  /** 403 si la zona queda fuera del alcance del permiso. */
  private async assertZone(req: Request, zoneId: string) {
    const zones = await this.rooms.visibleZoneIds(caller(req), PERMISSION);
    if (zones && !zones.has(zoneId)) throw new HttpError(403, "HOTEL_ACCESS_DENIED");
  }

  create = async (req: Request, res: Response) => {
    const input = HotelRoomReviewCreateDto.parse(req.body);
    await this.assertZone(req, await this.reviews.roomZone(input.roomId));
    res.status(201).json(await this.reviews.create(input, req.user!.id));
  };

  table = async (req: Request, res: Response) => {
    const params = parseTableParams(req.body);
    const zones = await this.rooms.visibleZoneIds(caller(req), PERMISSION);
    const { data, total } = await this.reviews.table(params, zones);
    res.json(paginatedTable(params, data, total));
  };

  consolidated = async (req: Request, res: Response) => {
    const from = new Date(String(req.query.from ?? ""));
    const to = new Date(String(req.query.to ?? ""));
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) throw new HttpError(400, "INVALID_FILTER", { field: "from/to" });
    if (from > to) throw new HttpError(400, "INVALID_RANGE");
    const zoneId = typeof req.query.zoneId === "string" && req.query.zoneId !== "" ? req.query.zoneId : undefined;
    const zones = await this.rooms.visibleZoneIds(caller(req), PERMISSION);
    res.json(await this.reviews.consolidated(from, to, zoneId, zones));
  };

  get = async (req: Request, res: Response) => {
    await this.assertZone(req, await this.reviews.zoneOfReview(req.params.id));
    res.json(await this.reviews.get(req.params.id));
  };

  history = async (req: Request, res: Response) => {
    await this.assertZone(req, await this.reviews.roomZone(req.params.id));
    res.json(await this.reviews.history(req.params.id));
  };
}
