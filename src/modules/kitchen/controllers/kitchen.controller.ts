import type { Request, Response } from "express";
import { HttpError } from "@core/middlewares/error.middleware";
import { parseTableParams, paginatedTable } from "@core/utils/table";
import {
  KITCHEN_IMPORT_STRATEGIES,
  buildKitchenImportTemplate,
  parseKitchenImportRows,
  type KitchenImportService,
  type KitchenImportStrategy,
} from "../services/kitchen-import.service";
import type { KitchenCatalogService } from "../services/kitchen-catalog.service";
import type { KitchenStockService } from "../services/kitchen-stock.service";
import type { PurchaseOrderService } from "../services/purchase-order.service";
import type { SupplierInvoiceService } from "../services/supplier-invoice.service";
import type { SupplierService } from "../services/supplier.service";
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
  CostCenterCreateDto,
  CostCenterUpdateDto,
  TaxRateCreateDto,
  TaxRateUpdateDto,
  KitchenUnitUpdateDto,
  PurchaseOrderCancelDto,
  PurchaseOrderCreateDto,
  PurchaseOrderEmailDto,
  PurchaseOrderReceiveDto,
  PurchaseOrderUpdateDto,
  SupplierCreateDto,
  SupplierInvoiceCancelDto,
  SupplierInvoiceCreateDto,
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

/** Estrategia de la carga cuando el artículo ya existe (default: sumar). */
const strategyOf = (req: Request): KitchenImportStrategy => {
  const value = String((req.body?.strategy ?? req.query.strategy ?? "ADD") as string).toUpperCase();
  const strategy = KITCHEN_IMPORT_STRATEGIES.find((candidate) => candidate === value);
  if (!strategy) throw new HttpError(400, "INVALID_IMPORT_STRATEGY");
  return strategy;
};

export class KitchenController {
  constructor(
    private readonly catalog: KitchenCatalogService,
    private readonly stock: KitchenStockService,
    private readonly purchaseOrders: PurchaseOrderService,
    private readonly invoices: SupplierInvoiceService,
    private readonly suppliers: SupplierService,
    private readonly imports: KitchenImportService
  ) {}

  // --- carga masiva del inventario (Excel) -----------------------------------

  /** Paso 1: qué haría la carga, sin escribir nada. */
  previewItemImport = async (req: Request, res: Response) => {
    if (!req.file) throw new HttpError(400, "EXCEL_FILE_REQUIRED");
    res.json(await this.imports.preview(parseKitchenImportRows(req.file.buffer), strategyOf(req)));
  };

  /** Paso 2: la carga real, en una sola transacción (todo o nada). */
  importItems = async (req: Request, res: Response) => {
    if (!req.file) throw new HttpError(400, "EXCEL_FILE_REQUIRED");
    const data = await this.stock.bulkImport(parseKitchenImportRows(req.file.buffer), req.user?.id, {
      requestId: requestIdOf(req),
      fileName: req.file.originalname ?? null,
      strategy: strategyOf(req),
    });
    res.status(data.repeated ? 200 : 201).json(data);
  };

  /** Plantilla Excel con los encabezados y los catálogos vigentes. */
  itemImportTemplate = async (_req: Request, res: Response) => {
    const buffer = buildKitchenImportTemplate(await this.imports.templateCatalog());
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", 'attachment; filename="plantilla-inventario-cocina.xlsx"');
    res.send(buffer);
  };

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
  listTaxRates = async (req: Request, res: Response) => {
    res.json(await this.catalog.listTaxRates(req.query.includeInactive === "true"));
  };
  createTaxRate = async (req: Request, res: Response) => {
    res.status(201).json(await this.catalog.createTaxRate(TaxRateCreateDto.parse(req.body)));
  };
  updateTaxRate = async (req: Request, res: Response) => {
    res.json(await this.catalog.updateTaxRate(req.params.id, TaxRateUpdateDto.parse(req.body)));
  };
  listCostCenters = async (req: Request, res: Response) => {
    res.json(await this.catalog.listCostCenters(req.query.includeInactive === "true"));
  };
  createCostCenter = async (req: Request, res: Response) => {
    res.status(201).json(await this.catalog.createCostCenter(CostCenterCreateDto.parse(req.body), actorOf(req)));
  };
  updateCostCenter = async (req: Request, res: Response) => {
    res.json(await this.catalog.updateCostCenter(req.params.id, CostCenterUpdateDto.parse(req.body), actorOf(req)));
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
    res.json(await this.suppliers.list(req.query.includeInactive === "true"));
  };
  suppliersTable = async (req: Request, res: Response) => {
    const params = parseTableParams(req.body);
    const { data, total } = await this.suppliers.table(params);
    res.json(paginatedTable(params, data, total));
  };
  supplierDetail = async (req: Request, res: Response) => {
    res.json(await this.suppliers.detail(req.params.id));
  };
  createSupplier = async (req: Request, res: Response) => {
    res.status(201).json(await this.suppliers.create(SupplierCreateDto.parse(req.body), actorOf(req)));
  };
  updateSupplier = async (req: Request, res: Response) => {
    res.json(await this.suppliers.update(req.params.id, SupplierUpdateDto.parse(req.body), actorOf(req)));
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

  // órdenes de compra (F3)
  purchaseOrdersTable = async (req: Request, res: Response) => {
    const params = parseTableParams(req.body);
    const { data, total } = await this.purchaseOrders.table(params);
    res.json(paginatedTable(params, data, total));
  };
  purchaseOrderDetail = async (req: Request, res: Response) => {
    res.json(await this.purchaseOrders.detail(req.params.id));
  };
  createPurchaseOrder = async (req: Request, res: Response) => {
    res.status(201).json(await this.purchaseOrders.create(PurchaseOrderCreateDto.parse(req.body), actorOf(req)));
  };
  updatePurchaseOrder = async (req: Request, res: Response) => {
    res.json(await this.purchaseOrders.update(req.params.id, PurchaseOrderUpdateDto.parse(req.body), actorOf(req)));
  };
  approvePurchaseOrder = async (req: Request, res: Response) => {
    res.json(await this.purchaseOrders.approve(req.params.id, actorOf(req)));
  };
  sendPurchaseOrder = async (req: Request, res: Response) => {
    res.json(await this.purchaseOrders.send(req.params.id, actorOf(req)));
  };
  sendPurchaseOrderEmail = async (req: Request, res: Response) => {
    const input = PurchaseOrderEmailDto.parse(req.body);
    res.json(await this.purchaseOrders.sendEmail(req.params.id, { ...input, file: req.file }, actorOf(req)));
  };
  purchaseOrderCostCenterSpending = async (req: Request, res: Response) => {
    const from = typeof req.query.from === "string" ? req.query.from : undefined;
    const to = typeof req.query.to === "string" ? req.query.to : undefined;
    res.json(await this.purchaseOrders.costCenterSpending(from, to));
  };
  cancelPurchaseOrder = async (req: Request, res: Response) => {
    const { notes } = PurchaseOrderCancelDto.parse(req.body ?? {});
    res.json(await this.purchaseOrders.cancel(req.params.id, notes, actorOf(req)));
  };
  receivePurchaseOrder = async (req: Request, res: Response) => {
    res
      .status(201)
      .json(await this.purchaseOrders.receive(req.params.id, PurchaseOrderReceiveDto.parse(req.body), actorOf(req), requestIdOf(req)));
  };

  // facturas de proveedor (F4)
  invoicesTable = async (req: Request, res: Response) => {
    const params = parseTableParams(req.body);
    const { data, total } = await this.invoices.table(params);
    res.json(paginatedTable(params, data, total));
  };
  invoiceDetail = async (req: Request, res: Response) => {
    res.json(await this.invoices.detail(req.params.id));
  };
  createInvoice = async (req: Request, res: Response) => {
    res.status(201).json(await this.invoices.register(SupplierInvoiceCreateDto.parse(req.body), actorOf(req)));
  };
  cancelInvoice = async (req: Request, res: Response) => {
    const { notes } = SupplierInvoiceCancelDto.parse(req.body ?? {});
    res.json(await this.invoices.cancel(req.params.id, notes, actorOf(req)));
  };
}
