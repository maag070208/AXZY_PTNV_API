import { z, registry } from "@core/swagger/registry";

/** Cantidad con hasta 3 decimales (kilos con gramos, litros con mililitros). */
const Quantity = z
  .number()
  .positive()
  .max(999_999_999)
  .refine((n) => Math.abs(n * 1000 - Math.round(n * 1000)) < 1e-6, "MAX_3_DECIMALS");
const StockLimit = z.number().min(0).max(999_999_999);
const Cost = z.number().min(0).max(99_999_999);
const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "DATE_FORMAT");
const OptionalText = (max: number) => z.string().trim().max(max).optional().nullable();

export const KITCHEN_ITEM_KINDS = ["CONSUMABLE", "DURABLE"] as const;
export const KITCHEN_STORAGES = ["DRY", "REFRIGERATED", "FROZEN"] as const;
export const KITCHEN_MOVEMENT_TYPES = ["STOCK_IN", "CONSUMPTION", "WASTE", "ADJUSTMENT_IN", "ADJUSTMENT_OUT", "REVERSAL"] as const;
export const KITCHEN_WASTE_REASONS = ["EXPIRED", "SPOILED", "BREAKAGE", "LOSS", "OTHER"] as const;

// --- catálogos ---------------------------------------------------------------

export const KitchenCategoryCreateDto = registry.register(
  "KitchenCategoryCreateInput",
  z.object({ name: z.string().trim().min(1).max(80) })
);
export const KitchenCategoryUpdateDto = registry.register(
  "KitchenCategoryUpdateInput",
  z.object({ name: z.string().trim().min(1).max(80).optional(), active: z.boolean().optional() })
);

// Unidades de medida (catálogo administrable: kilogramo, pieza, caja…).
const UnitFields = {
  code: z.string().trim().min(1).max(12),
  name: z.string().trim().min(1).max(40),
  /** Unidad discreta: el sugerido de reabastecimiento se redondea hacia arriba. */
  whole: z.boolean().default(false),
};
export const KitchenUnitCreateDto = registry.register("KitchenUnitCreateInput", z.object(UnitFields));
export const KitchenUnitUpdateDto = registry.register(
  "KitchenUnitUpdateInput",
  z.object({
    ...UnitFields,
    code: UnitFields.code.optional(),
    name: UnitFields.name.optional(),
    whole: z.boolean().optional(),
    active: z.boolean().optional(),
  })
);

// Proveedores (KITCHEN_SUPPLIERS_PLAN.md): datos fiscales, ubicación,
// condiciones, contactos y artículos que surte con su unidad de compra.
const Email = z.string().trim().email().max(120);
const Days = z.number().int().min(0).max(365);

export const SupplierContactDto = z.object({
  name: z.string().trim().min(1).max(120),
  position: OptionalText(60),
  phone: OptionalText(30),
  email: Email.optional().nullable(),
  isPrimary: z.boolean().default(false),
  notes: OptionalText(300),
});

export const SupplierItemDto = z.object({
  itemId: z.string().uuid(),
  supplierCode: OptionalText(40),
  purchaseUnit: z.string().trim().min(1).max(30),
  /** Unidades base del artículo en una unidad de compra (1 caja = 12 piezas). */
  factor: Quantity,
  lastUnitCost: Cost.optional().nullable(),
});

const SupplierFields = {
  name: z.string().trim().min(1).max(120),
  legalName: OptionalText(200),
  rfc: OptionalText(13),
  phone: OptionalText(30),
  email: Email.optional().nullable(),
  website: OptionalText(200),
  street: OptionalText(200),
  neighborhood: OptionalText(120),
  postalCode: z.string().trim().regex(/^\d{5}$/, "POSTAL_CODE").optional().nullable().or(z.literal("").transform(() => null)),
  city: OptionalText(120),
  state: OptionalText(80),
  locationNotes: OptionalText(500),
  mapsUrl: z.string().trim().url().max(500).optional().nullable().or(z.literal("").transform(() => null)),
  paymentTermsDays: Days.optional().nullable(),
  leadTimeDays: Days.optional().nullable(),
  notes: OptionalText(1000),
  /** Reemplazan el juego completo cuando vienen. */
  contacts: z.array(SupplierContactDto).max(30).optional(),
  items: z.array(SupplierItemDto).max(500).optional(),
};
export const SupplierCreateDto = registry.register("SupplierCreateInput", z.object(SupplierFields));
export const SupplierUpdateDto = registry.register(
  "SupplierUpdateInput",
  z.object({ ...SupplierFields, name: SupplierFields.name.optional(), active: z.boolean().optional() })
);

// Tasas de IVA (catálogo). `rate` es fracción: 0.16 = 16%.
const TaxRateFields = {
  name: z.string().trim().min(1).max(40),
  rate: z.number().min(0).max(0.9999),
};
export const TaxRateCreateDto = registry.register("TaxRateCreateInput", z.object(TaxRateFields));
export const TaxRateUpdateDto = registry.register(
  "TaxRateUpdateInput",
  z.object({ name: TaxRateFields.name.optional(), rate: TaxRateFields.rate.optional(), active: z.boolean().optional(), sortOrder: z.number().int().min(0).max(999).optional() })
);
export type TaxRateCreateInput = z.infer<typeof TaxRateCreateDto>;
export type TaxRateUpdateInput = z.infer<typeof TaxRateUpdateDto>;

// Centros de costo (NEXT_STEPS_PLAN 1.4): áreas que absorben el gasto.
const CostCenterFields = {
  name: z.string().trim().min(1).max(120),
  code: z.string().trim().min(1).max(30),
  departmentId: z.string().uuid().optional().nullable(),
};
export const CostCenterCreateDto = registry.register("CostCenterCreateInput", z.object(CostCenterFields));
export const CostCenterUpdateDto = registry.register(
  "CostCenterUpdateInput",
  z.object({ ...CostCenterFields, name: CostCenterFields.name.optional(), code: CostCenterFields.code.optional(), active: z.boolean().optional() })
);
export type CostCenterCreateInput = z.infer<typeof CostCenterCreateDto>;
export type CostCenterUpdateInput = z.infer<typeof CostCenterUpdateDto>;

// --- artículos ---------------------------------------------------------------

const ItemFields = {
  code: z.string().trim().min(1).max(30),
  name: z.string().trim().min(1).max(120),
  categoryId: z.string().uuid(),
  kind: z.enum(KITCHEN_ITEM_KINDS),
  unitId: z.string().uuid(),
  storage: z.enum(KITCHEN_STORAGES).default("DRY"),
  tracksExpiry: z.boolean().default(true),
  minStock: StockLimit.default(0),
  maxStock: StockLimit.nullable().optional(),
  notes: OptionalText(500),
  /** Tasa de IVA con que se compra normalmente (null = sin tasa por defecto). */
  defaultTaxRateId: z.string().trim().min(1).max(64).nullable().optional(),
};
export const KitchenItemCreateDto = registry.register("KitchenItemCreateInput", z.object(ItemFields));
export const KitchenItemUpdateDto = registry.register(
  "KitchenItemUpdateInput",
  z
    .object({
      code: ItemFields.code,
      name: ItemFields.name,
      categoryId: ItemFields.categoryId,
      kind: ItemFields.kind,
      unitId: ItemFields.unitId,
      storage: z.enum(KITCHEN_STORAGES),
      tracksExpiry: z.boolean(),
      minStock: StockLimit,
      maxStock: StockLimit.nullable(),
      notes: ItemFields.notes,
      defaultTaxRateId: z.string().trim().min(1).max(64).nullable(),
      active: z.boolean(),
    })
    .partial()
);

// --- movimientos -------------------------------------------------------------

const Common = {
  date: z.string().datetime({ offset: true }).optional(),
  reference: OptionalText(80),
  notes: OptionalText(500),
};

/** Entrada: cada renglón crea un lote (lote y caducidad; costo opcional). */
export const KitchenStockInDto = registry.register(
  "KitchenStockInInput",
  z.object({
    ...Common,
    supplierId: z.string().uuid().optional().nullable(),
    lines: z
      .array(
        z.object({
          itemId: z.string().uuid(),
          quantity: Quantity,
          lotCode: z.string().trim().min(1).max(40).optional(),
          expiresAt: Day.optional().nullable(),
          unitCost: Cost.optional().nullable(),
        })
      )
      .min(1)
      .max(200),
  })
);

const OutLine = z.object({
  itemId: z.string().uuid(),
  quantity: Quantity,
  /** Lote elegido a mano; sin lote, la API reparte por FEFO. */
  lotId: z.string().uuid().optional(),
});

/** Consumo o merma (la merma exige motivo). */
export const KitchenStockOutDto = registry.register(
  "KitchenStockOutInput",
  z.object({
    ...Common,
    type: z.enum(["CONSUMPTION", "WASTE"]),
    wasteReason: z.enum(KITCHEN_WASTE_REASONS).optional(),
    lines: z.array(OutLine).min(1).max(200),
  })
);

/** Ajuste por conteo físico sobre lotes existentes. */
export const KitchenAdjustmentDto = registry.register(
  "KitchenAdjustmentInput",
  z.object({
    ...Common,
    type: z.enum(["ADJUSTMENT_IN", "ADJUSTMENT_OUT"]),
    lines: z
      .array(z.object({ itemId: z.string().uuid(), lotId: z.string().uuid(), quantity: Quantity }))
      .min(1)
      .max(200),
  })
);

export const KitchenFefoPreviewDto = registry.register(
  "KitchenFefoPreviewInput",
  z.object({
    type: z.enum(["CONSUMPTION", "WASTE"]).default("CONSUMPTION"),
    lines: z.array(z.object({ itemId: z.string().uuid(), quantity: Quantity })).min(1).max(200),
  })
);

export const KitchenReverseDto = registry.register(
  "KitchenReverseInput",
  z.object({ notes: OptionalText(500) })
);

// --- órdenes de compra (F3) --------------------------------------------------

export const PURCHASE_ORDER_STATUSES = [
  "DRAFT",
  "APPROVED",
  "SENT",
  "PARTIALLY_RECEIVED",
  "RECEIVED",
  "CANCELLED",
] as const;

const PurchaseOrderLineFields = {
  itemId: z.string().uuid(),
  quantity: Quantity,
  unitCost: Cost.optional().nullable(),
  notes: OptionalText(200),
  /**
   * Captura en la unidad de compra del proveedor (caja, bulto): `quantity` y
   * `unitCost` vienen por unidad de compra y la API los convierte a unidad base.
   */
  usePurchaseUnit: z.boolean().optional(),
  /** Tasa de IVA del renglón; si no viene, la del artículo (o sin IVA). */
  taxRateId: z.string().trim().min(1).max(64).nullable().optional(),
};

/** Crear una OC: proveedor + líneas (se puede precargar desde Reabastecimiento). */
export const PurchaseOrderCreateDto = registry.register(
  "PurchaseOrderCreateInput",
  z.object({
    supplierId: z.string().uuid(),
    costCenterId: z.string().uuid().optional().nullable(),
    expectedAt: Day.optional().nullable(),
    notes: OptionalText(500),
    lines: z.array(z.object(PurchaseOrderLineFields)).min(1).max(200),
  })
);

/** Editar una OC en borrador; si `lines` viene, reemplaza el juego completo. */
export const PurchaseOrderUpdateDto = registry.register(
  "PurchaseOrderUpdateInput",
  z.object({
    supplierId: z.string().uuid().optional(),
    costCenterId: z.string().uuid().optional().nullable(),
    expectedAt: Day.optional().nullable(),
    notes: OptionalText(500),
    lines: z.array(z.object(PurchaseOrderLineFields)).min(1).max(200).optional(),
  })
);

/** Recepción: por línea, cuánto llega + lote + caducidad + costo (opcional). */
export const PurchaseOrderReceiveDto = registry.register(
  "PurchaseOrderReceiveInput",
  z.object({
    date: z.string().datetime({ offset: true }).optional(),
    reference: OptionalText(80),
    notes: OptionalText(500),
    lines: z
      .array(
        z.object({
          lineId: z.string().uuid(),
          quantity: Quantity,
          lotCode: z.string().trim().min(1).max(40).optional(),
          expiresAt: Day.optional().nullable(),
          unitCost: Cost.optional().nullable(),
        })
      )
      .min(1)
      .max(200),
  })
);

export const PurchaseOrderCancelDto = registry.register(
  "PurchaseOrderCancelInput",
  z.object({ notes: OptionalText(500) })
);

/** Envío de la OC al proveedor: destinatarios separados por coma, asunto y mensaje. */
export const PurchaseOrderEmailDto = registry.register(
  "PurchaseOrderEmailInput",
  z.object({
    to: z.string().trim().min(1).max(2000),
    subject: z.string().trim().min(1).max(200),
    message: z.string().trim().min(1).max(5000),
  })
);
export type PurchaseOrderEmailInput = z.infer<typeof PurchaseOrderEmailDto>;

// --- facturas de proveedor (F4) ----------------------------------------------

export const INVOICE_STATUSES = ["ACTIVE", "CANCELLED"] as const;

/** Registrar una factura (con o sin orden de compra). */
export const SupplierInvoiceCreateDto = registry.register(
  "SupplierInvoiceCreateInput",
  z.object({
    supplierId: z.string().uuid(),
    purchaseOrderId: z.string().uuid().optional().nullable(),
    number: z.string().trim().min(1).max(60),
    uuid: OptionalText(60),
    date: Day,
    subtotal: Cost.optional().nullable(),
    tax: Cost.optional().nullable(),
    total: Cost,
    notes: OptionalText(500),
    lines: z
      .array(
        z.object({
          itemId: z.string().uuid(),
          purchaseOrderLineId: z.string().uuid().optional().nullable(),
          quantity: Quantity,
          unitCost: Cost,
          /** Tasa de IVA del renglón; si no viene, la del renglón de la OC (o sin IVA). */
          taxRateId: z.string().trim().min(1).max(64).nullable().optional(),
        })
      )
      .min(1)
      .max(200),
  })
);

export const SupplierInvoiceCancelDto = registry.register(
  "SupplierInvoiceCancelInput",
  z.object({ notes: OptionalText(500) })
);

export type KitchenCategoryCreateInput = z.infer<typeof KitchenCategoryCreateDto>;
export type KitchenCategoryUpdateInput = z.infer<typeof KitchenCategoryUpdateDto>;
export type KitchenUnitCreateInput = z.infer<typeof KitchenUnitCreateDto>;
export type KitchenUnitUpdateInput = z.infer<typeof KitchenUnitUpdateDto>;
export type SupplierCreateInput = z.infer<typeof SupplierCreateDto>;
export type SupplierUpdateInput = z.infer<typeof SupplierUpdateDto>;
export type SupplierContactInput = z.infer<typeof SupplierContactDto>;
export type SupplierItemInput = z.infer<typeof SupplierItemDto>;
export type KitchenItemCreateInput = z.infer<typeof KitchenItemCreateDto>;
export type KitchenItemUpdateInput = z.infer<typeof KitchenItemUpdateDto>;
export type KitchenStockInInput = z.infer<typeof KitchenStockInDto>;
export type KitchenStockOutInput = z.infer<typeof KitchenStockOutDto>;
export type KitchenAdjustmentInput = z.infer<typeof KitchenAdjustmentDto>;
export type KitchenFefoPreviewInput = z.infer<typeof KitchenFefoPreviewDto>;
export type PurchaseOrderCreateInput = z.infer<typeof PurchaseOrderCreateDto>;
export type PurchaseOrderUpdateInput = z.infer<typeof PurchaseOrderUpdateDto>;
export type PurchaseOrderReceiveInput = z.infer<typeof PurchaseOrderReceiveDto>;
export type PurchaseOrderCancelInput = z.infer<typeof PurchaseOrderCancelDto>;
export type SupplierInvoiceCreateInput = z.infer<typeof SupplierInvoiceCreateDto>;
export type SupplierInvoiceCancelInput = z.infer<typeof SupplierInvoiceCancelDto>;
