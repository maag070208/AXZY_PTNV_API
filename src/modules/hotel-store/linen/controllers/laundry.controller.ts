import type { Request, Response } from "express";
import { HttpError } from "@core/middlewares/error.middleware";
import { paginatedTable, parseTableParams } from "@core/utils/table";
import type { HotelWarehouseService } from "../../services/warehouse.service";
import type { Caller } from "../../services/rooms.service";
import {
  HotelDirtyReceiptCreateDto,
  HotelFirstWashDto,
  HotelLaundryProcessDto,
  HotelRoomTurnoverDto,
  HotelSupplierReturnDto,
  HotelSupplyAddLinesDto,
  HotelSupplyDeliverDto,
  HotelSupplyDifferenceDto,
  HotelSupplyPickupManyDto,
  HotelSupplyRequestCreateDto,
  HotelSupplyRequestFulfillDto,
} from "../models/dto/laundry.dto";
import { assertCanFirstWash, assertProcessScope, assertSupplierReturnScope } from "../services/role-scope-rules";
import { dayRange } from "../services/day-range";
import type { HotelLaundryService } from "../services/laundry.service";
import type { HotelSupplyRequestService } from "../services/supply-request.service";
import type { HotelDirtyReceiptService } from "../services/dirty-receipt.service";

const caller = (req: Request): Caller => req.user as unknown as Caller;
const rolesOf = (req: Request): string[] | undefined => (req.user as unknown as { roles?: string[] }).roles;
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
    assertCanFirstWash(rolesOf(req));
    const origin = input.fromWarehouseId;
    if (origin) await this.warehouses.assertWarehousesVisible(caller(req), [origin], "hotel_linen.transfer_send");
    else await this.assertAllScope(req, "hotel_linen.transfer_send");
    res.status(201).json(await this.laundry.firstWash(input, req.user!.id, req.header("Idempotency-Key") ?? null));
  };

  supplierReturn = async (req: Request, res: Response) => {
    const input = HotelSupplierReturnDto.parse(req.body);
    assertSupplierReturnScope(rolesOf(req), input.lines.map((l) => l.fromStage));
    const laundry = await this.laundry.laundry();
    await this.warehouses.assertWarehousesVisible(caller(req), [laundry.id], "hotel_linen.transfer_send");
    res.status(201).json(await this.laundry.supplierReturn(input, req.user!.id, req.header("Idempotency-Key") ?? null));
  };

  // ── Proceso de lavandería ────────────────────────────────────────────────

  process = async (req: Request, res: Response) => {
    const input = HotelLaundryProcessDto.parse(req.body);
    assertProcessScope(rolesOf(req), input.moves);
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

  // ── Pedido por habitación (tablet) ───────────────────────────────────────

  turnoverSuggestion = async (req: Request, res: Response) => {
    const { area } = await this.requests.roomArea(req.params.id);
    await this.warehouses.assertWarehousesVisible(caller(req), [area.id], "hotel_linen.request");
    res.json(await this.requests.turnoverSuggestion(req.params.id));
  };

  roomTurnover = async (req: Request, res: Response) => {
    const input = HotelRoomTurnoverDto.parse(req.body);
    const { area } = await this.requests.roomArea(input.roomId);
    await this.warehouses.assertWarehousesVisible(caller(req), [area.id], "hotel_linen.request");
    const { created, request } = await this.requests.roomTurnover(input, caller(req));
    res.status(created ? 201 : 200).json({ created, request });
  };

  pickupRequest = async (req: Request, res: Response) => {
    await this.assertRequestArea(req, "hotel_linen.carry");
    res.json(await this.requests.pickup(req.params.id, req.user!.id));
  };

  /** Recoger varias habitaciones de su zona en un viaje. Las que quedan fuera de su alcance cuentan como conflicto. */
  pickupMany = async (req: Request, res: Response) => {
    const { ids } = HotelSupplyPickupManyDto.parse(req.body);
    const visible = await this.warehouses.visibleWarehouseIds(caller(req), "hotel_linen.carry");
    const allowed: string[] = [];
    const outOfScope: string[] = [];
    for (const id of new Set(ids)) {
      const header = await this.requests.header(id);
      if (!visible || visible.includes(header.requestingWarehouseId)) allowed.push(id);
      else outOfScope.push(id);
    }
    const { picked, conflicts } = await this.requests.pickupMany(allowed, req.user!.id);
    res.json({ picked, conflicts: [...conflicts, ...outOfScope] });
  };

  deliverRequest = async (req: Request, res: Response) => {
    const input = HotelSupplyDeliverDto.parse(req.body ?? {});
    await this.assertRequestArea(req, "hotel_linen.carry");
    res.json(await this.requests.deliver(req.params.id, req.user!.id, input));
  };

  addRequestLines = async (req: Request, res: Response) => {
    const input = HotelSupplyAddLinesDto.parse(req.body);
    await this.assertRequestArea(req, "hotel_linen.request");
    res.json(await this.requests.addLines(req.params.id, input, req.user!.id));
  };

  reportDifference = async (req: Request, res: Response) => {
    const input = HotelSupplyDifferenceDto.parse(req.body);
    await this.assertRequestArea(req, "hotel_linen.request");
    res.status(201).json(await this.requests.reportDifference(req.params.id, input, req.user!.id));
  };

  /** Cola por rol: cada sección según el alcance de los permisos fulfill / request / carry. */
  requestQueue = async (req: Request, res: Response) => {
    const c = caller(req);
    const [fulfill, request, carry] = await Promise.all([
      this.warehouses.visibleWarehouseIds(c, "hotel_linen.fulfill"),
      this.warehouses.visibleWarehouseIds(c, "hotel_linen.request"),
      this.warehouses.visibleWarehouseIds(c, "hotel_linen.carry"),
    ]);
    res.json(await this.requests.queue({ fulfill, request, carry }, req.user!.id));
  };

  /** Pedidos por habitación de hoy (cualquier estado visible) con el mismo alcance por zona que la cola. */
  requestsToday = async (req: Request, res: Response) => {
    res.json(await this.requests.today(await this.queueScope(req), dayRange()));
  };

  /** Historial paginado (últimos 60 días) de pedidos por habitación. */
  requestsHistory = async (req: Request, res: Response) => {
    const page = Math.max(1, Math.floor(Number(req.query.page ?? 1)) || 1);
    const pageSize = Math.min(100, Math.max(1, Math.floor(Number(req.query.pageSize ?? 30)) || 30));
    res.json(await this.requests.history(await this.queueScope(req), page, pageSize));
  };

  private queueScope = async (req: Request) => {
    const c = caller(req);
    const [fulfill, request, carry] = await Promise.all([
      this.warehouses.visibleWarehouseIds(c, "hotel_linen.fulfill"),
      this.warehouses.visibleWarehouseIds(c, "hotel_linen.request"),
      this.warehouses.visibleWarehouseIds(c, "hotel_linen.carry"),
    ]);
    return { fulfill, request, carry };
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
