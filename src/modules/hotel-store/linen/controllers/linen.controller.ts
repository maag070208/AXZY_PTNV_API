import type { Request, Response } from "express";
import { HttpError } from "@core/middlewares/error.middleware";
import { scopeOf } from "@core/permissions";
import { paginatedTable, parseTableParams } from "@core/utils/table";
import type { HotelWarehouseService } from "../../services/warehouse.service";
import type { Caller } from "../../services/rooms.service";
import { HotelTransferReceiveDto, HotelTransferSendDto, HotelWarehouseLimitsDto } from "../models/dto/transfer.dto";
import type { HotelLinenTransferService } from "../services/transfer.service";
import type { HotelLinenStockService } from "../services/linen-stock.service";

const caller = (req: Request): Caller => req.user as unknown as Caller;

/** Traspasos con doble firma, existencias, lotes y límites de blancos. */
export class HotelLinenController {
  constructor(
    private readonly transfers: HotelLinenTransferService,
    private readonly stock: HotelLinenStockService,
    private readonly warehouses: HotelWarehouseService
  ) {}

  sendTransfer = async (req: Request, res: Response) => {
    const input = HotelTransferSendDto.parse(req.body);
    // El alcance de enviar se evalúa sobre el almacén de origen.
    await this.warehouses.assertWarehousesVisible(caller(req), [input.fromWarehouseId], "hotel_linen.transfer_send");
    res.status(201).json(await this.transfers.send(input, req.user!.id, req.header("Idempotency-Key") ?? null));
  };

  receiveTransfer = async (req: Request, res: Response) => {
    const input = HotelTransferReceiveDto.parse(req.body);
    const transfer = await this.transfers.get(req.params.id);
    await this.warehouses.assertWarehousesVisible(caller(req), [transfer.warehouseId], "hotel_linen.transfer_receive");
    res.json(await this.transfers.receive(req.params.id, input, req.user!.id));
  };

  cancelTransfer = async (req: Request, res: Response) => {
    await this.transfers.get(req.params.id);
    const canApprove = scopeOf(req.user!, "hotel_store.adjust_approve") === "ALL";
    res.json(await this.transfers.cancel(req.params.id, req.user!.id, canApprove));
  };

  transferTable = async (req: Request, res: Response) => {
    const params = parseTableParams(req.body);
    const visible = await this.warehouses.visibleWarehouseIds(caller(req), "hotel_linen.view");
    const receivable = await this.warehouses.visibleWarehouseIds(caller(req), "hotel_linen.transfer_receive");
    const { data, total } = await this.transfers.table(params, visible, receivable);
    res.json(paginatedTable(params, data, total));
  };

  getTransfer = async (req: Request, res: Response) => {
    const transfer = await this.transfers.get(req.params.id);
    const visible = await this.warehouses.visibleWarehouseIds(caller(req), "hotel_linen.view");
    // Basta con ver el origen o el destino.
    if (visible && !visible.includes(transfer.fromWarehouseId ?? "") && !visible.includes(transfer.warehouseId ?? "")) {
      throw new HttpError(403, "HOTEL_ACCESS_DENIED");
    }
    res.json(transfer);
  };

  stockSummary = async (req: Request, res: Response) => {
    const visible = await this.warehouses.visibleWarehouseIds(caller(req), "hotel_linen.view");
    const kind = typeof req.query.kind === "string" && req.query.kind ? req.query.kind : undefined;
    res.json(await this.stock.summary(visible, kind));
  };

  lots = async (req: Request, res: Response) => {
    const visible = await this.warehouses.visibleWarehouseIds(caller(req), "hotel_linen.view");
    const productId = typeof req.query.productId === "string" && req.query.productId ? req.query.productId : undefined;
    res.json(await this.stock.lots(productId, visible));
  };

  getLimits = async (req: Request, res: Response) => {
    res.json(await this.stock.limits(req.params.id));
  };

  setLimits = async (req: Request, res: Response) => {
    res.json(await this.stock.setLimits(req.params.id, HotelWarehouseLimitsDto.parse(req.body).limits));
  };
}
