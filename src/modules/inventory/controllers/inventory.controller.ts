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
import type { InventoryAuditService } from "../services/inventory-audit.service";

const IDEMPOTENCY_KEY = /^[A-Za-z0-9_-]{8,100}$/;

/** Encabezado `Idempotency-Key` (opcional): identifica la petición para no duplicarla. */
const requestIdOf = (req: Request): string | undefined => {
  const key = req.get("Idempotency-Key");
  if (key === undefined) return undefined;
  if (!IDEMPOTENCY_KEY.test(key)) throw new HttpError(400, "INVALID_IDEMPOTENCY_KEY");
  return key;
};

export class InventoryController {
  constructor(
    private readonly service: InventoryService,
    private readonly auditor: InventoryAuditService
  ) {}

  // Auditoría: corre las reglas en vivo (sin avisar).
  audit = async (_req: Request, res: Response) => {
    res.json(await this.auditor.run());
  };

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
    if (!data) throw new HttpError(404, "DEVICE_NOT_FOUND");
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
    res.json(await this.service.updateUnit(req.params.id, input, req.user?.id));
  };

  unitHistory = async (req: Request, res: Response) => {
    res.json(await this.service.unitHistory(req.params.id));
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
    if (!data) throw new HttpError(404, "MOVEMENT_NOT_FOUND");
    res.json(data);
  };

  registerMovement = async (req: Request, res: Response) => {
    const input = CreateMovementSchema.parse(req.body);
    const data = await this.service.registerMovement(
      {
        ...input,
        requestId: requestIdOf(req),
        // Un renglón puede venir por unidades exactas; el servicio siempre
        // trabaja con una cantidad, y `unitId`/`unitIds` viajan aparte.
        items: input.items.map((item) => ({
          ...item,
          quantity: item.unitIds?.length ?? item.quantity ?? 1,
        })),
      },
      req.user?.id
    );
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
    if (!data) throw new HttpError(404, "LOAN_NOT_FOUND");
    res.json(data);
  };

  createLoan = async (req: Request, res: Response) => {
    const input = CreateLoanSchema.parse(req.body);
    const data = await this.service.registerMovement(
      {
        type: "LOAN",
        requestId: requestIdOf(req),
        custodianId: input.custodianId,
        departmentId: input.departmentId,
        subareaId: input.subareaId,
        notes: input.notes,
        items: input.items.map((item) => ({ ...item, quantity: item.unitIds?.length ?? item.quantity! })),
      },
      req.user?.id
    );
    res.status(201).json(data);
  };

  cancelLoan = async (req: Request, res: Response) => {
    res.json(await this.service.cancelLoan(req.params.id, req.user?.id));
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
        requestId: requestIdOf(req),
        loanId: input.loanId,
        custodianId: input.custodianId,
        notes: input.notes,
        // `deviceId` lo resuelve el servicio a partir del renglón del préstamo.
        items: input.items.map((item) => ({
          ...item,
          deviceId: "",
          quantity: item.unitIds?.length ?? item.quantity!,
        })),
      },
      req.user?.id
    );
    res.status(201).json(data);
  };

  dashboard = async (_req: Request, res: Response) => {
    res.json(await this.service.dashboard());
  };
}