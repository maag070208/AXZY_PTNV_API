import type { Request, Response } from "express";
import { HttpError } from "@core/middlewares/error.middleware";
import { parseTableParams, paginatedTable } from "@core/utils/table";
import type { KitchenCatalogService } from "../services/kitchen-catalog.service";
import type { KitchenStockService } from "../services/kitchen-stock.service";
import {
  KitchenAdjustmentDto,
  KitchenCategoryCreateDto,
  KitchenCategoryUpdateDto,
  KitchenFefoPreviewDto,
  KitchenItemCreateDto,
  KitchenItemUpdateDto,
  KitchenReverseDto,
  KitchenStockInDto,
  KitchenStockOutDto,
  KitchenUnitCreateDto,
  KitchenUnitUpdateDto,
  SupplierCreateDto,
  SupplierUpdateDto,
} from "../models/dto/kitchen.dto";

const IDEMPOTENCY_KEY = /^[A-Za-z0-9_-]{8,100}$/;

/** Encabezado `Idempotency-Key` (opcional): identifica la petición para no duplicarla. */
const requestIdOf = (req: Request): string | undefined => {
  const key = req.get("Idempotency-Key");
  if (key === undefined) return undefined;
  if (!IDEMPOTENCY_KEY.test(key)) throw new HttpError(400, "INVALID_IDEMPOTENCY_KEY");
  return key;
};

const actorOf = (req: Request): string => {
  if (!req.user) throw new HttpError(401, "UNAUTHENTICATED");
  return req.user.id;
};

export class KitchenController {
  constructor(
    private readonly catalog: KitchenCatalogService,
    private readonly stock: KitchenStockService
  ) {}

  // catálogos
  listCategories = async (req: Request, res: Response) => {
    res.json(await this.catalog.listCategories(req.query.includeInactive === "true"));
  };
  createCategory = async (req: Request, res: Response) => {
    res.status(201).json(await this.catalog.createCategory(KitchenCategoryCreateDto.parse(req.body)));
  };
  updateCategory = async (req: Request, res: Response) => {
    res.json(await this.catalog.updateCategory(req.params.id, KitchenCategoryUpdateDto.parse(req.body)));
  };
  listUnits = async (req: Request, res: Response) => {
    res.json(await this.catalog.listUnits(req.query.includeInactive === "true"));
  };
  createUnit = async (req: Request, res: Response) => {
    res.status(201).json(await this.catalog.createUnit(KitchenUnitCreateDto.parse(req.body)));
  };
  updateUnit = async (req: Request, res: Response) => {
    res.json(await this.catalog.updateUnit(req.params.id, KitchenUnitUpdateDto.parse(req.body)));
  };
  listSuppliers = async (req: Request, res: Response) => {
    res.json(await this.catalog.listSuppliers(req.query.includeInactive === "true"));
  };
  createSupplier = async (req: Request, res: Response) => {
    res.status(201).json(await this.catalog.createSupplier(SupplierCreateDto.parse(req.body)));
  };
  updateSupplier = async (req: Request, res: Response) => {
    res.json(await this.catalog.updateSupplier(req.params.id, SupplierUpdateDto.parse(req.body)));
  };

  // artículos
  itemsTable = async (req: Request, res: Response) => {
    const params = parseTableParams(req.body);
    const { data, total } = await this.stock.itemsTable(params);
    res.json(paginatedTable(params, data, total));
  };
  itemDetail = async (req: Request, res: Response) => {
    res.json(await this.stock.itemDetail(req.params.id));
  };
  createItem = async (req: Request, res: Response) => {
    res.status(201).json(await this.catalog.createItem(KitchenItemCreateDto.parse(req.body), actorOf(req)));
  };
  updateItem = async (req: Request, res: Response) => {
    res.json(await this.catalog.updateItem(req.params.id, KitchenItemUpdateDto.parse(req.body), actorOf(req)));
  };

  // lotes y movimientos
  lotsTable = async (req: Request, res: Response) => {
    const params = parseTableParams(req.body);
    const { data, total } = await this.stock.lotsTable(params);
    res.json(paginatedTable(params, data, total));
  };
  movementsTable = async (req: Request, res: Response) => {
    const params = parseTableParams(req.body);
    const { data, total } = await this.stock.movementsTable(params);
    res.json(paginatedTable(params, data, total));
  };
  movement = async (req: Request, res: Response) => {
    res.json(await this.stock.movement(req.params.id));
  };
  stockIn = async (req: Request, res: Response) => {
    res.status(201).json(await this.stock.stockIn(KitchenStockInDto.parse(req.body), actorOf(req), requestIdOf(req)));
  };
  stockOut = async (req: Request, res: Response) => {
    res.status(201).json(await this.stock.stockOut(KitchenStockOutDto.parse(req.body), actorOf(req), requestIdOf(req)));
  };
  adjust = async (req: Request, res: Response) => {
    res.status(201).json(await this.stock.adjust(KitchenAdjustmentDto.parse(req.body), actorOf(req), requestIdOf(req)));
  };
  fefoPreview = async (req: Request, res: Response) => {
    res.json(await this.stock.fefoPreview(KitchenFefoPreviewDto.parse(req.body)));
  };
  reverse = async (req: Request, res: Response) => {
    const { notes } = KitchenReverseDto.parse(req.body ?? {});
    res.status(201).json(await this.stock.reverse(req.params.id, notes, actorOf(req), requestIdOf(req)));
  };

  // reabastecimiento y alertas
  restock = async (_req: Request, res: Response) => {
    res.json(await this.stock.restock());
  };
  alerts = async (_req: Request, res: Response) => {
    res.json(await this.stock.alerts());
  };
}
