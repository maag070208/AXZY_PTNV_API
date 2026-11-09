import type { Request, Response } from "express";
import { HttpError } from "@core/middlewares/error.middleware";
import { paginatedTable, parseTableParams } from "@core/utils/table";
import type { HotelWarehouseService } from "../../services/warehouse.service";
import type { Caller } from "../../services/rooms.service";
import { HotelLoanCreateDto, HotelLoanReturnDto, HotelShiftCloseDto } from "../models/dto/loan.dto";
import type { HotelLoanService } from "../services/loan.service";
import type { HotelShiftCloseService } from "../services/loan-shift-close.service";

const caller = (req: Request): Caller => req.user as unknown as Caller;
const str = (v: unknown) => (typeof v === "string" && v ? v : undefined);

/** Préstamo de toallas por punto y corte de turno. */
export class HotelLoanController {
  constructor(
    private readonly loans: HotelLoanService,
    private readonly closes: HotelShiftCloseService,
    private readonly warehouses: HotelWarehouseService
  ) {}

  // ── Préstamos ────────────────────────────────────────────────────────────

  create = async (req: Request, res: Response) => {
    const input = HotelLoanCreateDto.parse(req.body);
    await this.warehouses.assertWarehousesVisible(caller(req), [input.warehouseId], "hotel_linen.loans");
    res.status(201).json(await this.loans.create(input, req.user!.id));
  };

  returnLoan = async (req: Request, res: Response) => {
    const input = HotelLoanReturnDto.parse(req.body);
    const header = await this.loans.header(req.params.folio);
    await this.warehouses.assertWarehousesVisible(caller(req), [header.pointWarehouseId], "hotel_linen.loans");
    res.json(await this.loans.returnLoan(req.params.folio, input, req.user!.id));
  };

  table = async (req: Request, res: Response) => {
    const params = parseTableParams(req.body);
    const visible = await this.warehouses.visibleWarehouseIdsAny(caller(req), ["hotel_linen.loans", "hotel_linen.view"]);
    const { data, total } = await this.loans.table(params, visible);
    res.json(paginatedTable(params, data, total));
  };

  pointSummary = async (req: Request, res: Response) => {
    const warehouseId = str(req.query.warehouseId);
    if (!warehouseId) throw new HttpError(400, "INVALID_FILTER", { field: "warehouseId" });
    await this.warehouses.assertWarehousesVisible(caller(req), [warehouseId], "hotel_linen.view");
    res.json(await this.loans.pointSummary(warehouseId));
  };

  // ── Corte de turno ───────────────────────────────────────────────────────

  closePreview = async (req: Request, res: Response) => {
    const warehouseId = str(req.query.warehouseId);
    if (!warehouseId) throw new HttpError(400, "INVALID_FILTER", { field: "warehouseId" });
    await this.warehouses.assertWarehousesVisible(caller(req), [warehouseId], "hotel_linen.shift_close");
    const marked = str(req.query.mark)?.split(",").filter(Boolean) ?? [];
    res.json(await this.closes.preview(warehouseId, marked));
  };

  createClose = async (req: Request, res: Response) => {
    const input = HotelShiftCloseDto.parse(req.body);
    await this.warehouses.assertWarehousesVisible(caller(req), [input.warehouseId], "hotel_linen.shift_close");
    res.status(201).json(await this.closes.create(input, req.user!.id));
  };

  reviewClose = async (req: Request, res: Response) => {
    res.json(await this.closes.review(req.params.id, req.user!.id));
  };

  closeTable = async (req: Request, res: Response) => {
    const params = parseTableParams(req.body);
    const visible = await this.warehouses.visibleWarehouseIdsAny(caller(req), ["hotel_linen.shift_close", "hotel_linen.deposits_review", "hotel_linen.view"]);
    const { data, total } = await this.closes.table(params, visible);
    res.json(paginatedTable(params, data, total));
  };

  getClose = async (req: Request, res: Response) => {
    const header = await this.closes.header(req.params.id);
    await this.warehouses.assertWarehousesVisible(caller(req), [header.pointWarehouseId], "hotel_linen.view");
    res.json(await this.closes.get(req.params.id));
  };
}
