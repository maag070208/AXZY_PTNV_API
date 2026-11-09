import type { Request, Response } from "express";
import { scopeOf } from "@core/permissions";
import { paginatedTable, parseTableParams } from "@core/utils/table";
import {
  HotelPurchaseCloseDto,
  HotelPurchaseConvertDto,
  HotelPurchaseHoldResolveDto,
  HotelPurchaseOrderCreateDto,
  HotelPurchaseOrderUpdateDto,
  HotelPurchaseReceiptDto,
  HotelPurchaseWeeklyDto,
} from "../models/dto/purchase.dto";
import type { HotelPurchaseOrderService } from "../services/purchase-order.service";
import type { HotelPurchaseReceiptService } from "../services/purchase-receipt.service";
import type { HotelPurchaseRequestService } from "../services/purchase-request.service";

/** Compras de blancos: órdenes, recepción contra factura, apartados y solicitudes de reposición. */
export class HotelPurchaseController {
  constructor(
    private readonly orders: HotelPurchaseOrderService,
    private readonly receipts: HotelPurchaseReceiptService,
    private readonly requests: HotelPurchaseRequestService
  ) {}

  // ── Órdenes ──────────────────────────────────────────────────────────────

  orderTable = async (req: Request, res: Response) => {
    const params = parseTableParams(req.body);
    const { data, total } = await this.orders.table(params);
    res.json(paginatedTable(params, data, total));
  };

  lookups = async (_req: Request, res: Response) => {
    res.json(await this.orders.lookups());
  };

  getOrder = async (req: Request, res: Response) => {
    res.json(await this.orders.get(req.params.id));
  };

  createOrder = async (req: Request, res: Response) => {
    res.status(201).json(await this.orders.create(HotelPurchaseOrderCreateDto.parse(req.body), req.user!.id));
  };

  updateOrder = async (req: Request, res: Response) => {
    res.json(await this.orders.update(req.params.id, HotelPurchaseOrderUpdateDto.parse(req.body), req.user!.id));
  };

  approveOrder = async (req: Request, res: Response) => {
    res.json(await this.orders.approve(req.params.id, req.user!.id));
  };

  cancelOrder = async (req: Request, res: Response) => {
    res.json(await this.orders.cancel(req.params.id, req.user!.id));
  };

  closeOrder = async (req: Request, res: Response) => {
    res.json(await this.orders.close(req.params.id, HotelPurchaseCloseDto.parse(req.body), req.user!.id));
  };

  // ── Recepción y apartados ────────────────────────────────────────────────

  receive = async (req: Request, res: Response) => {
    const input = HotelPurchaseReceiptDto.parse(req.body);
    // Pasar la tolerancia de recibir de más exige además el permiso de aprobar.
    const canApprove = scopeOf(req.user!, "hotel_purchase.approve") === "ALL";
    res.status(201).json(await this.receipts.receive(req.params.id, input, req.user!.id, canApprove, req.header("Idempotency-Key") ?? null));
  };

  holdTable = async (req: Request, res: Response) => {
    const params = parseTableParams(req.body);
    const { data, total } = await this.receipts.holdTable(params);
    res.json(paginatedTable(params, data, total));
  };

  resolveHold = async (req: Request, res: Response) => {
    res.json(await this.receipts.resolveHold(req.params.id, HotelPurchaseHoldResolveDto.parse(req.body), req.user!.id));
  };

  // ── Solicitudes de reposición ────────────────────────────────────────────

  requestTable = async (req: Request, res: Response) => {
    const params = parseTableParams(req.body);
    const { data, total } = await this.requests.table(params);
    res.json(paginatedTable(params, data, total));
  };

  getRequest = async (req: Request, res: Response) => {
    res.json(await this.requests.get(req.params.id));
  };

  generateWeekly = async (req: Request, res: Response) => {
    const { weekFrom } = HotelPurchaseWeeklyDto.parse(req.body);
    const result = await this.requests.generateWeekly(weekFrom, req.user!.id);
    res.status(result.created ? 201 : 200).json(result);
  };

  generateLowStock = async (req: Request, res: Response) => {
    const { created, request } = await this.requests.generateLowStock(req.user!.id);
    res.status(created ? 201 : 200).json({ created, request });
  };

  convertRequest = async (req: Request, res: Response) => {
    res.json(await this.requests.convert(req.params.id, HotelPurchaseConvertDto.parse(req.body), req.user!.id));
  };

  dismissRequest = async (req: Request, res: Response) => {
    res.json(await this.requests.dismiss(req.params.id, req.user!.id));
  };
}
