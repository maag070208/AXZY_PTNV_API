import type { Request, Response } from "express";
import type { HotelWarehouseService } from "../../services/warehouse.service";
import type { Caller } from "../../services/rooms.service";
import { HotelGuestLossCreateDto, HotelGuestLossFromExtraDto, HotelGuestLossFromLoanDto } from "../models/dto/guest-loss.dto";
import type { HotelGuestLossService } from "../services/guest-loss.service";
import type { HotelWriteoffService } from "../services/writeoff.service";

const caller = (req: Request): Caller => req.user as unknown as Caller;

/** Pérdidas por huésped: registro directo y conversión desde préstamos / adicionales. */
export class HotelGuestLossController {
  constructor(
    private readonly guestLosses: HotelGuestLossService,
    private readonly writeoffs: HotelWriteoffService,
    private readonly warehouses: HotelWarehouseService
  ) {}

  create = async (req: Request, res: Response) => {
    const input = HotelGuestLossCreateDto.parse(req.body ?? {});
    await this.warehouses.assertWarehousesVisible(caller(req), [input.warehouseId], "hotel_linen.writeoff_request");
    const { id } = await this.guestLosses.create(input, req.user!.id);
    res.status(201).json(await this.writeoffs.get(id));
  };

  fromLoan = async (req: Request, res: Response) => {
    const input = HotelGuestLossFromLoanDto.parse(req.body ?? {});
    await this.warehouses.assertWarehousesVisible(caller(req), [await this.guestLosses.loanWarehouse(req.params.folio)], "hotel_linen.writeoff_request");
    const { id } = await this.guestLosses.fromLoan(req.params.folio, input, req.user!.id);
    res.status(201).json(await this.writeoffs.get(id));
  };

  fromExtra = async (req: Request, res: Response) => {
    const input = HotelGuestLossFromExtraDto.parse(req.body ?? {});
    await this.warehouses.assertWarehousesVisible(caller(req), [await this.guestLosses.extraWarehouse(req.params.id)], "hotel_linen.writeoff_request");
    const { id } = await this.guestLosses.fromExtra(req.params.id, input, req.user!.id);
    res.status(201).json(await this.writeoffs.get(id));
  };
}
