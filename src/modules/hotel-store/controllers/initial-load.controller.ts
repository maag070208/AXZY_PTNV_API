import { Request, Response } from "express";
import { z } from "@core/swagger/registry";
import { HttpError } from "@core/middlewares/error.middleware";
import { scopeOf } from "@core/permissions";
import type { HotelInitialLoadService } from "../services/initial-load.service";
import type { HotelWarehouseService } from "../services/warehouse.service";
import type { Caller } from "../services/rooms.service";

const WarehouseIdDto = z.object({ warehouseId: z.string().min(1) });

export class HotelInitialLoadController {
  constructor(
    private readonly initialLoad: HotelInitialLoadService,
    private readonly warehouses: HotelWarehouseService
  ) {}

  template = async (_req: Request, res: Response) => {
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", 'attachment; filename="initial-load-template.xlsx"');
    res.send(this.initialLoad.template());
  };

  preview = async (req: Request, res: Response) => {
    const { warehouseId } = await this.checked(req);
    res.json(await this.initialLoad.preview(this.file(req), warehouseId));
  };

  confirm = async (req: Request, res: Response) => {
    const { warehouseId } = await this.checked(req);
    res.status(201).json(await this.initialLoad.confirm(this.file(req), warehouseId, req.user!.id));
  };

  /** Scope check for the warehouse in the body: the caller must see it under `stock_in`. */
  private async checked(req: Request): Promise<{ warehouseId: string }> {
    const { warehouseId } = WarehouseIdDto.parse(req.body);
    if (scopeOf(req.user!, "hotel_store.stock_in") === "NONE") {
      throw new HttpError(403, "INSUFFICIENT_PERMISSIONS");
    }
    await this.warehouses.assertWarehousesVisible(req.user as unknown as Caller, [warehouseId], "hotel_store.stock_in");
    return { warehouseId };
  }

  private file(req: Request): Buffer {
    if (!req.file) throw new HttpError(422, "HOTEL_FILE_REQUIRED");
    return req.file.buffer;
  }
}
