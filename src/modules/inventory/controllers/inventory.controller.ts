import { Request, Response } from "express";
import { HttpError } from "@core/middlewares/error.middleware";
import { parseTableParams, paginatedTable } from "@core/utils/table";
import { InventoryService } from "../services/inventory.service";
import { MovementInputSchema } from "../models/dto/inventory.dto";

export class InventoryController {
  constructor(private readonly inventoryService: InventoryService) {}

  private parseFilters(req: Request) {
    return {
      deviceId: typeof req.query.deviceId === "string" ? req.query.deviceId : undefined,
      locationId: typeof req.query.locationId === "string" ? req.query.locationId : undefined,
      start: typeof req.query.start === "string" ? req.query.start : undefined,
      end: typeof req.query.end === "string" ? req.query.end : undefined,
    };
  }

  list = async (req: Request, res: Response) => {
    const data = await this.inventoryService.list(this.parseFilters(req));
    res.json(data);
  };

  movTable = async (req: Request, res: Response) => {
    const params = parseTableParams(req.body);
    const { data, total } = await this.inventoryService.movementsTable(params);
    res.json(paginatedTable(params, data, total));
  };

  getKardex = async (req: Request, res: Response) => {
    const data = await this.inventoryService.getKardex(req.params.deviceId);
    res.json(data);
  };

  registerMovement = async (req: Request, res: Response) => {
    const input = MovementInputSchema.parse(req.body);
    const userId = input.userId ?? req.user?.id;
    if (!userId) throw new HttpError(400, "User ID requerido");
    const data = await this.inventoryService.registerMovement({
      ...input,
      userId,
      userName: input.userName,
    });
    res.status(201).json(data);
  };

  summary = async (_req: Request, res: Response) => {
    const data = await this.inventoryService.summary();
    res.json(data);
  };
}