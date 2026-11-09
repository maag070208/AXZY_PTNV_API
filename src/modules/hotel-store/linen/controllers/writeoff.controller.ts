import type { Request, Response } from "express";
import { HttpError } from "@core/middlewares/error.middleware";
import { scopeOf } from "@core/permissions";
import { paginatedTable, parseTableParams } from "@core/utils/table";
import type { HotelWarehouseService } from "../../services/warehouse.service";
import type { Caller } from "../../services/rooms.service";
import {
  HotelWriteoffApproveDto,
  HotelWriteoffCreateDto,
  HotelWriteoffRejectDto,
  HotelWriteoffReviewDto,
} from "../models/dto/writeoff.dto";
import type { HotelWriteoffService } from "../services/writeoff.service";
import type { HotelSignatureService } from "../services/signature.service";

const caller = (req: Request): Caller => req.user as unknown as Caller;
const str = (v: unknown) => (typeof v === "string" && v ? v : undefined);

/** Bajas de blancos: solicitud con fotos, revisión, autorización, reporte semanal y estado físico. */
export class HotelWriteoffController {
  constructor(
    private readonly writeoffs: HotelWriteoffService,
    private readonly signatures: HotelSignatureService,
    private readonly warehouses: HotelWarehouseService
  ) {}

  create = async (req: Request, res: Response) => {
    // multipart: `lines` llega como JSON en texto.
    let lines: unknown = req.body?.lines;
    if (typeof lines === "string") {
      try { lines = JSON.parse(lines); } catch { throw new HttpError(422, "HOTEL_WRITEOFF_LINES_INVALID"); }
    }
    const input = HotelWriteoffCreateDto.parse({ ...req.body, lines });
    await this.warehouses.assertWarehousesVisible(caller(req), [input.warehouseId], "hotel_linen.writeoff_request");
    const files = ((req.files as Express.Multer.File[] | undefined) ?? []).map((f) => ({
      buffer: f.buffer, mimetype: f.mimetype, size: f.size, originalname: f.originalname,
    }));
    res.status(201).json(await this.writeoffs.create(input, files, req.user!.id));
  };

  table = async (req: Request, res: Response) => {
    const params = parseTableParams(req.body);
    const visible = await this.warehouses.visibleWarehouseIds(caller(req), "hotel_linen.view");
    const { data, total } = await this.writeoffs.table(params, visible);
    res.json(paginatedTable(params, data, total));
  };

  get = async (req: Request, res: Response) => {
    await this.assertVisible(req);
    res.json(await this.writeoffs.get(req.params.id));
  };

  evidence = async (req: Request, res: Response) => {
    await this.assertVisible(req);
    const file = await this.writeoffs.evidenceFile(req.params.id, req.params.evidenceId);
    res.setHeader("Content-Type", file.mime);
    res.send(file.body);
  };

  review = async (req: Request, res: Response) => {
    const input = HotelWriteoffReviewDto.parse(req.body ?? {});
    const { userId, method } = await this.signer(input.cosignToken, req);
    res.json(await this.writeoffs.review(req.params.id, req.user!.id, userId, method, input.notes));
  };

  approve = async (req: Request, res: Response) => {
    const input = HotelWriteoffApproveDto.parse(req.body ?? {});
    const { userId, method } = await this.signer(input.cosignToken, req);
    const canSkipReview = scopeOf(req.user!, "hotel_linen.writeoff_approve") === "ALL";
    res.json(await this.writeoffs.approve(req.params.id, req.user!.id, userId, method, input.disposition, canSkipReview, input.notes));
  };

  reject = async (req: Request, res: Response) => {
    const input = HotelWriteoffRejectDto.parse(req.body ?? {});
    const { userId, method } = await this.signer(input.cosignToken, req);
    res.json(await this.writeoffs.reject(req.params.id, req.user!.id, userId, method, input.notes));
  };

  weekly = async (req: Request, res: Response) => {
    const visible = await this.warehouses.visibleWarehouseIds(caller(req), "hotel_linen.view");
    res.json(await this.writeoffs.weekly(str(req.query.from), str(req.query.to), visible));
  };

  condition = async (req: Request, res: Response) => {
    const visible = await this.warehouses.visibleWarehouseIds(caller(req), "hotel_linen.view");
    res.json(await this.writeoffs.condition(str(req.query.warehouseId), visible));
  };

  /** Quien firma: el usuario de la sesión, o el del cosignToken (método PASSWORD). */
  private async signer(cosignToken: string | null | undefined, req: Request) {
    if (cosignToken) return { userId: await this.signatures.resolveCosignUser(cosignToken), method: "PASSWORD" as const };
    return { userId: req.user!.id, method: "SESSION" as const };
  }

  private async assertVisible(req: Request) {
    const warehouseId = await this.writeoffs.warehouseOf(req.params.id);
    await this.warehouses.assertWarehousesVisible(caller(req), [warehouseId], "hotel_linen.view");
  }
}
