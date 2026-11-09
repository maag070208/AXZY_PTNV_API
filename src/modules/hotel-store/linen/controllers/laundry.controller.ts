import type { Request, Response } from "express";
import { HttpError } from "@core/middlewares/error.middleware";
import { paginatedTable, parseTableParams } from "@core/utils/table";
import type { HotelWarehouseService } from "../../services/warehouse.service";
import type { Caller } from "../../services/rooms.service";
import {
  HotelDirtyReceiptCreateDto,
  HotelFirstWashDto,
  HotelLaundryProcessDto,
  HotelSupplierReturnDto,
  HotelSupplyRequestCreateDto,
  HotelSupplyRequestFulfillDto,
} from "../models/dto/laundry.dto";
import type { HotelLaundryService } from "../services/laundry.service";
import type { HotelSupplyRequestService } from "../services/supply-request.service";
import type { HotelDirtyReceiptService } from "../services/dirty-receipt.service";

const caller = (req: Request): Caller => req.user as unknown as Caller;
const str = (v: unknown) => (typeof v === "string" && v ? v : undefined);
const num = (v: unknown) => {
  const n = Number(v ?? 0);
  if (!Number.isFinite(n) || n < 0) throw new HttpError(400, "INVALID_FILTER");
  return n;
};

/** Ciclo de lavandería: primera lavada, devolución, proceso, pedidos de área, recepción de sucios y conciliación. */
export class HotelLaundryController {
  constructor(
    private readonly laundry: HotelLaundryService,
    private readonly requests: HotelSupplyRequestService,
    private readonly dirty: HotelDirtyReceiptService,
    private readonly warehouses: HotelWarehouseService
  ) {}

  // ── Primera lavada y devolución a proveedor ──────────────────────────────

  firstWash = async (req: Request, res: Response) => {
    const input = HotelFirstWashDto.parse(req.body);
    const origin = input.fromWarehouseId;
    if (origin) await this.warehouses.assertWarehousesVisible(caller(req), [origin], "hotel_linen.transfer_send");
    else await this.assertAllScope(req, "hotel_linen.transfer_send");
    res.status(201).json(await this.laundry.firstWash(input, req.user!.id, req.header("Idempotency-Key") ?? null));
  };

  supplierReturn = async (req: Request, res: Response) => {
    const input = HotelSupplierReturnDto.parse(req.body);
    const laundry = await this.laundry.laundry();
    await this.warehouses.assertWarehousesVisible(caller(req), [laundry.id], "hotel_linen.transfer_send");
    res.status(201).json(await this.laundry.supplierReturn(input, req.user!.id, req.header("Idempotency-Key") ?? null));
  };

  // ── Proceso de lavandería ────────────────────────────────────────────────

  process = async (req: Request, res: Response) => {
    const input = HotelLaundryProcessDto.parse(req.body);
    const laundry = await this.laundry.laundry();
    await this.warehouses.assertWarehousesVisible(caller(req), [laundry.id], "hotel_linen.process");
    res.status(201).json(await this.laundry.process(input, req.user!.id));
  };

  board = async (req: Request, res: Response) => {
    const laundry = await this.laundry.laundry();
    await this.warehouses.assertWarehousesVisible(caller(req), [laundry.id], "hotel_linen.view");
    res.json(await this.laundry.board());
  };

  // ── Pedidos de área ──────────────────────────────────────────────────────

  suggestion = async (req: Request, res: Response) => {
    const warehouseId = str(req.query.warehouseId);
    if (!warehouseId) throw new HttpError(400, "INVALID_FILTER", { field: "warehouseId" });
    await this.warehouses.assertWarehousesVisible(caller(req), [warehouseId], "hotel_linen.view");
    res.json(await this.requests.suggestion(warehouseId, num(req.query.checkouts), num(req.query.occupied)));
  };

  createRequest = async (req: Request, res: Response) => {
    const input = HotelSupplyRequestCreateDto.parse(req.body);
    await this.warehouses.assertWarehousesVisible(caller(req), [input.requestingWarehouseId], "hotel_linen.request");
    res.status(201).json(await this.requests.create(input, req.user!.id));
  };

  submitRequest = async (req: Request, res: Response) => {
    await this.assertRequestArea(req, "hotel_linen.request");
    res.json(await this.requests.submit(req.params.id, req.user!.id));
  };

  cancelRequest = async (req: Request, res: Response) => {
    await this.assertRequestArea(req, "hotel_linen.request");
    res.json(await this.requests.cancel(req.params.id, req.user!.id));
  };

  confirmRequest = async (req: Request, res: Response) => {
    await this.assertRequestArea(req, "hotel_linen.request");
    res.json(await this.requests.confirm(req.params.id, req.user!.id));
  };

  fulfillRequest = async (req: Request, res: Response) => {
    const input = HotelSupplyRequestFulfillDto.parse(req.body);
    const header = await this.requests.header(req.params.id);
    // Surtir se evalúa sobre el almacén que surte.
    await this.warehouses.assertWarehousesVisible(caller(req), [header.sourceWarehouseId], "hotel_linen.fulfill");
    res.json(await this.requests.fulfill(req.params.id, input, req.user!.id));
  };

  requestTable = async (req: Request, res: Response) => {
    const params = parseTableParams(req.body);
    const visible = await this.warehouses.visibleWarehouseIds(caller(req), "hotel_linen.view");
    const { data, total } = await this.requests.table(params, visible);
    res.json(paginatedTable(params, data, total));
  };

  getRequest = async (req: Request, res: Response) => {
    const header = await this.requests.header(req.params.id);
    await this.assertAnyVisible(req, [header.requestingWarehouseId, header.sourceWarehouseId]);
    res.json(await this.requests.get(req.params.id));
  };

  // ── Recepción de sucios y conciliación ───────────────────────────────────

  createDirtyReceipt = async (req: Request, res: Response) => {
    const input = HotelDirtyReceiptCreateDto.parse(req.body);
    const laundry = await this.laundry.laundry();
    await this.warehouses.assertWarehousesVisible(caller(req), [laundry.id], "hotel_linen.dirty_receive");
    res.status(201).json(await this.dirty.create(input, req.user!.id));
  };

  dirtyReceiptTable = async (req: Request, res: Response) => {
    const params = parseTableParams(req.body);
    const visible = await this.warehouses.visibleWarehouseIds(caller(req), "hotel_linen.view");
    const { data, total } = await this.dirty.table(params, visible);
    res.json(paginatedTable(params, data, total));
  };

  dirtyReceiptPrefill = async (req: Request, res: Response) => {
    const warehouseId = str(req.query.warehouseId);
    if (!warehouseId) throw new HttpError(400, "INVALID_FILTER", { field: "warehouseId" });
    await this.warehouses.assertWarehousesVisible(caller(req), [warehouseId], "hotel_linen.view");
    res.json(await this.dirty.prefill(warehouseId, str(req.query.date)));
  };

  getDirtyReceipt = async (req: Request, res: Response) => {
    const header = await this.dirty.header(req.params.id);
    await this.assertAnyVisible(req, [header.originWarehouseId]);
    res.json(await this.dirty.get(req.params.id));
  };

  dailyReconciliation = async (req: Request, res: Response) => {
    const visible = await this.warehouses.visibleWarehouseIds(caller(req), "hotel_linen.view");
    res.json(await this.dirty.dailyReconciliation(str(req.query.date), visible));
  };

  // ── Alcance ──────────────────────────────────────────────────────────────

  private async assertRequestArea(req: Request, permission: string) {
    const header = await this.requests.header(req.params.id);
    await this.warehouses.assertWarehousesVisible(caller(req), [header.requestingWarehouseId], permission);
  }

  private async assertAnyVisible(req: Request, warehouseIds: string[]) {
    const visible = await this.warehouses.visibleWarehouseIds(caller(req), "hotel_linen.view");
    if (visible && !warehouseIds.some((id) => visible.includes(id))) throw new HttpError(403, "HOTEL_ACCESS_DENIED");
  }

  /** Sin almacén indicado la operación usa el predeterminado: exige alcance total. */
  private async assertAllScope(req: Request, permission: string) {
    const visible = await this.warehouses.visibleWarehouseIds(caller(req), permission);
    if (visible) throw new HttpError(403, "HOTEL_ACCESS_DENIED");
  }
}
