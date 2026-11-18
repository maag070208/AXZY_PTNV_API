import type { Request, Response } from "express";
import { HttpError } from "@core/middlewares/error.middleware";
import { HotelRoomParSaveDto, HotelRoomParKindSchema } from "../models/dto/room-par.dto";
import type { HotelRoomParService } from "../services/room-par.service";

/** Dotación por componente y esperado por habitación. */
export class HotelRoomParController {
  constructor(private readonly pars: HotelRoomParService) {}

  list = async (req: Request, res: Response) => {
    const kind = HotelRoomParKindSchema.safeParse(req.query.kind);
    if (!kind.success) throw new HttpError(400, "INVALID_FILTER", { field: "kind" });
    res.json(await this.pars.list(kind.data));
  };

  save = async (req: Request, res: Response) => {
    const input = HotelRoomParSaveDto.parse(req.body);
    res.json(await this.pars.save(input, req.user!.id));
  };

  expected = async (req: Request, res: Response) => {
    res.json(await this.pars.expectedForRoom(req.params.id));
  };
}
