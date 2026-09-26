import { Request, Response } from "express";
import { HttpError } from "@core/middlewares/error.middleware";
import { InventoryService } from "../services/inventory.service";
import {
  CreateLoanReturnSchema,
  CreateDeviceSchema,
  CreateMovementSchema,
  CreateLoanSchema,
  CreateDeviceTypeSchema,
  UpdateDeviceSchema,
  UpdateLoanSchema,
  UpdateDeviceTypeSchema,
  UpdateUnitSchema,
} from "../models/dto/inventory.dto";

export class InventoryController {
  constructor(private readonly service: InventoryService) {}

  // Tipos
  listTypes = async (_req: Request, res: Response) => {
    res.json(await this.service.listTypes());
  };

  createType = async (req: Request, res: Response) => {
    const input = CreateDeviceTypeSchema.parse(req.body);
    res.status(201).json(await this.service.createType(input));
  };

  updateType = async (req: Request, res: Response) => {
    const input = UpdateDeviceTypeSchema.parse(req.body);
    res.json(await this.service.updateType(req.params.id, input));
  };

  deleteType = async (req: Request, res: Response) => {
    res.json(await this.service.deleteType(req.params.id));
  };

  // Dispositivos
  listDevices = async (req: Request, res: Response) => {
    const { typeId, q, stock } = req.query;
    const filters = {
      typeId: typeof typeId === "string" ? typeId : undefined,
      q: typeof q === "string" ? q : undefined,
    };
    const data =
      stock === "true"
        ? await this.service.listDevicesWithStock(filters)
        : await this.service.listDevices(filters);
    res.json(data);
  };

  getDevice = async (req: Request, res: Response) => {
    const data = await this.service.getDevice(req.params.id);
    if (!data) throw new HttpError(404, "Dispositivo no encontrado");
    res.json(data);
  };

  createDevice = async (req: Request, res: Response) => {
    const input = CreateDeviceSchema.parse(req.body);
    const data = await this.service.createDevice(input, req.user?.id);
    res.status(201).json(data);
  };

  updateDevice = async (req: Request, res: Response) => {
    const input = UpdateDeviceSchema.parse(req.body);
    res.json(await this.service.updateDevice(req.params.id, input));
  };

  deleteDevice = async (req: Request, res: Response) => {
    res.json(await this.service.deleteDevice(req.params.id));
  };

  stock = async (req: Request, res: Response) => {
    res.json(await this.service.stock(req.params.id));
  };

  units = async (req: Request, res: Response) => {
    res.json(await this.service.units(req.params.id));
  };

  searchUnits = async (req: Request, res: Response) => {
    const q = typeof req.query.q === "string" ? req.query.q : "";
    const limit = Number(req.query.limit) || 20;
    res.json(await this.service.searchUnits(q, limit));
  };

  updateUnit = async (req: Request, res: Response) => {
    const input = UpdateUnitSchema.parse(req.body);
    res.json(await this.service.updateUnit(req.params.id, input));
  };

  stockLedger = async (req: Request, res: Response) => {
    res.json(await this.service.stockLedger(req.params.id));
  };

  // Movimientos
  listMovements = async (req: Request, res: Response) => {
    const { type, deviceId } = req.query;
    res.json(
      await this.service.listMovements({
        type: typeof type === "string" ? type : undefined,
        deviceId: typeof deviceId === "string" ? deviceId : undefined,
      })
    );
  };

  getMovement = async (req: Request, res: Response) => {
    const data = await this.service.getMovement(req.params.id);
    if (!data) throw new HttpError(404, "Movimiento no encontrado");
    res.json(data);
  };

  registerMovement = async (req: Request, res: Response) => {
    const input = CreateMovementSchema.parse(req.body);
    const data = await this.service.registerMovement(input, req.user?.id);
    res.status(201).json(data);
  };

  revert = async (req: Request, res: Response) => {
    const data = await this.service.registerMovement(
      { type: "REVERSAL", movementId: req.params.id, items: [] },
      req.user?.id
    );
    res.status(201).json(data);
  };

  // Préstamos
  listLoans = async (req: Request, res: Response) => {
    const { status, custodianId } = req.query;
    res.json(
      await this.service.listLoans({
        status: typeof status === "string" ? status : undefined,
        custodianId: typeof custodianId === "string" ? custodianId : undefined,
      })
    );
  };

  getLoan = async (req: Request, res: Response) => {
    const data = await this.service.getLoan(req.params.id);
    if (!data) throw new HttpError(404, "Préstamo no encontrado");
    res.json(data);
  };

  createLoan = async (req: Request, res: Response) => {
    const input = CreateLoanSchema.parse(req.body);
    const data = await this.service.registerMovement(
      {
        type: "LOAN",
        custodianId: input.custodianId,
        departmentId: input.departmentId,
        subareaId: input.subareaId,
        notes: input.notes,
        items: input.items,
      },
      req.user?.id
    );
    res.status(201).json(data);
  };

  cancelLoan = async (req: Request, res: Response) => {
    res.json(await this.service.cancelLoan(req.params.id));
  };

  updateLoan = async (req: Request, res: Response) => {
    const input = UpdateLoanSchema.parse(req.body);
    res.json(await this.service.updateLoan(req.params.id, input));
  };

  // Devoluciones
  listReturns = async (req: Request, res: Response) => {
    const { loanId } = req.query;
    res.json(
      await this.service.listReturns({
        loanId: typeof loanId === "string" ? loanId : undefined,
      })
    );
  };

  createLoanReturn = async (req: Request, res: Response) => {
    const input = CreateLoanReturnSchema.parse(req.body);
    const data = await this.service.registerMovement(
      {
        type: "RETURN",
        loanId: input.loanId,
        custodianId: input.custodianId,
        notes: input.notes,
        items: input.items as unknown as import("../models/entity/inventory.entity").MovementItemInput[],
      },
      req.user?.id
    );
    res.status(201).json(data);
  };

  dashboard = async (_req: Request, res: Response) => {
    res.json(await this.service.dashboard());
  };
}