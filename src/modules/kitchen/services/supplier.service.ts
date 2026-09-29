import { Prisma, type PrismaClient } from "@prisma/client";
import { prismaClient } from "@core/config/database";
import { HttpError } from "@core/middlewares/error.middleware";
import { filterBool, filterText, orderByOf, type ITDataTableFetchParams } from "@core/utils/table";
import type { AuditLogger } from "@modules/users/services/user.service";
import type {
  SupplierContactInput,
  SupplierCreateInput,
  SupplierItemInput,
  SupplierUpdateInput,
} from "../models/dto/kitchen.dto";
import { isValidRfc, normalizeRfc, withPrimary } from "./supplier-rules";

type Tx = Prisma.TransactionClient;

const num = (d: Prisma.Decimal) => d.toNumber();
const numOrNull = (d: Prisma.Decimal | null) => (d === null ? null : d.toNumber());

/** Índice único violado → 409 con el código del campo (nombre o RFC). */
const uniqueError = (err: unknown): HttpError | null => {
  if (!(err instanceof Prisma.PrismaClientKnownRequestError) || err.code !== "P2002") return null;
  const target = ([] as string[]).concat((err.meta?.target as string[] | string) ?? []).join(",");
  if (target.includes("rfc")) return new HttpError(409, "SUPPLIER_RFC_TAKEN");
  return new HttpError(409, "SUPPLIER_NAME_TAKEN");
};

const contactSelect = { id: true, name: true, position: true, phone: true, email: true, isPrimary: true, notes: true } as const;

/**
 * Proveedores (KITCHEN_SUPPLIERS_PLAN.md): datos fiscales, ubicación,
 * condiciones comerciales, contactos y artículos que surte con su unidad de
 * compra. Los contactos y los artículos se guardan como juego completo junto
 * con el proveedor, en una sola transacción. No se borran: se desactivan.
 */
export class SupplierService {
  constructor(
    private readonly db: PrismaClient = prismaClient,
    private readonly audit?: AuditLogger
  ) {}

  /** Lista simple para selects, con su contacto principal. */
  list(includeInactive: boolean) {
    return this.db.supplier.findMany({
      where: includeInactive ? {} : { active: true },
      orderBy: { name: "asc" },
      include: { contacts: { where: { isPrimary: true }, select: contactSelect } },
    });
  }

  async table(params: ITDataTableFetchParams) {
    const f = params.filters;
    const name = filterText(f, "name");
    const contact = filterText(f, "contact");
    const where: Prisma.SupplierWhereInput = {
      rfc: filterText(f, "rfc"),
      city: filterText(f, "city"),
      state: filterText(f, "state"),
      active: filterBool(f, "active"),
      AND: [
        ...(name ? [{ OR: [{ name }, { legalName: name }] }] : []),
        ...(contact ? [{ contacts: { some: { OR: [{ name: contact }, { position: contact }, { phone: contact }] } } }] : []),
      ],
    };
    const orderBy = orderByOf(
      params.sort,
      { name: "name", rfc: "rfc", city: "city", state: "state", active: "active", createdAt: "createdAt" },
      [{ name: "asc" }]
    ) as Prisma.SupplierOrderByWithRelationInput[];
    const [rows, total] = await Promise.all([
      this.db.supplier.findMany({
        where,
        orderBy,
        skip: (params.page - 1) * params.limit,
        take: params.limit,
        include: {
          contacts: { where: { isPrimary: true }, select: contactSelect },
          _count: { select: { contacts: true, items: true } },
        },
      }),
      this.db.supplier.count({ where }),
    ]);
    return {
      data: rows.map(({ contacts, _count, ...s }) => ({
        ...s,
        primaryContact: contacts[0] ?? null,
        contactsCount: _count.contacts,
        itemsCount: _count.items,
      })),
      total,
    };
  }

  async detail(id: string) {
    const supplier = await this.db.supplier.findUnique({
      where: { id },
      include: {
        contacts: { orderBy: [{ isPrimary: "desc" }, { sortOrder: "asc" }], select: contactSelect },
        items: {
          orderBy: { item: { name: "asc" } },
          include: { item: { select: { id: true, code: true, name: true, active: true, unit: { select: { id: true, code: true, name: true, whole: true } } } } },
        },
        purchaseOrders: { orderBy: { createdAt: "desc" }, take: 10, select: { id: true, number: true, status: true, createdAt: true, expectedAt: true } },
        invoices: { orderBy: { date: "desc" }, take: 10, select: { id: true, number: true, date: true, total: true, status: true } },
      },
    });
    if (!supplier) throw new HttpError(404, "SUPPLIER_NOT_FOUND");
    return {
      ...supplier,
      items: supplier.items.map((i) => ({
        id: i.id,
        item: i.item,
        supplierCode: i.supplierCode,
        purchaseUnit: i.purchaseUnit,
        factor: num(i.factor),
        lastUnitCost: numOrNull(i.lastUnitCost),
        lastPurchasedAt: i.lastPurchasedAt?.toISOString() ?? null,
      })),
      purchaseOrders: supplier.purchaseOrders.map((o) => ({
        ...o,
        createdAt: o.createdAt.toISOString(),
        expectedAt: o.expectedAt ? o.expectedAt.toISOString().slice(0, 10) : null,
      })),
      invoices: supplier.invoices.map((inv) => ({ ...inv, date: inv.date.toISOString().slice(0, 10), total: num(inv.total) })),
    };
  }

  async create(input: SupplierCreateInput, actorId?: string) {
    const { contacts, items, ...data } = input;
    const rfc = this.checkRfc(data.rfc);
    const contactRows = this.checkContacts(contacts ?? []);
    await this.checkItems(items ?? []);
    const id = await this.write(async (tx) => {
      const supplier = await tx.supplier.create({ data: { ...data, rfc }, select: { id: true } });
      await this.replaceChildren(tx, supplier.id, contactRows, items ?? []);
      return supplier.id;
    });
    await this.audit?.({ action: "SUPPLIER_CREATED", entityType: "Supplier", entityId: id, userId: actorId, newState: { name: data.name, rfc } });
    return this.detail(id);
  }

  async update(id: string, input: SupplierUpdateInput, actorId?: string) {
    const current = await this.db.supplier.findUnique({ where: { id }, select: { id: true, name: true, rfc: true, active: true } });
    if (!current) throw new HttpError(404, "SUPPLIER_NOT_FOUND");
    const { contacts, items, ...data } = input;
    const rfc = data.rfc !== undefined ? this.checkRfc(data.rfc) : undefined;
    const contactRows = contacts ? this.checkContacts(contacts) : null;
    if (items) await this.checkItems(items, id);
    await this.write(async (tx) => {
      await tx.supplier.update({ where: { id }, data: { ...data, ...(rfc !== undefined && { rfc }) } });
      if (contactRows) {
        await tx.supplierContact.deleteMany({ where: { supplierId: id } });
        await this.createContacts(tx, id, contactRows);
      }
      if (items) await this.replaceItems(tx, id, items);
      return id;
    });
    await this.audit?.({
      action: "SUPPLIER_UPDATED",
      entityType: "Supplier",
      entityId: id,
      userId: actorId,
      previousState: current,
      newState: { name: data.name ?? current.name, rfc: rfc === undefined ? current.rfc : rfc, active: data.active ?? current.active },
    });
    return this.detail(id);
  }

  // --- internos -----------------------------------------------------------------

  private async write(fn: (tx: Tx) => Promise<string>) {
    try {
      return await this.db.$transaction(fn);
    } catch (err) {
      throw uniqueError(err) ?? err;
    }
  }

  private checkRfc(value: string | null | undefined): string | null {
    const rfc = normalizeRfc(value);
    if (rfc && !isValidRfc(rfc)) throw new HttpError(400, "INVALID_RFC");
    return rfc;
  }

  private checkContacts(contacts: SupplierContactInput[]) {
    const rows = withPrimary(contacts);
    if (!rows) throw new HttpError(400, "SUPPLIER_PRIMARY_CONTACT");
    return rows;
  }

  /** Artículos existentes y sin repetir. Un artículo inactivo solo se acepta si ya lo surtía. */
  private async checkItems(items: SupplierItemInput[], supplierId?: string) {
    const ids = items.map((i) => i.itemId);
    if (new Set(ids).size !== ids.length) throw new HttpError(400, "DUPLICATE_SUPPLIER_ITEM");
    if (ids.length === 0) return;
    const [found, current] = await Promise.all([
      this.db.kitchenItem.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, active: true } }),
      supplierId ? this.db.supplierItem.findMany({ where: { supplierId }, select: { itemId: true } }) : Promise.resolve([]),
    ]);
    const byId = new Map(found.map((i) => [i.id, i]));
    const already = new Set(current.map((c) => c.itemId));
    for (const id of ids) {
      const item = byId.get(id);
      if (!item) throw new HttpError(404, "KITCHEN_ITEM_NOT_FOUND");
      if (!item.active && !already.has(id)) throw new HttpError(409, "KITCHEN_ITEM_INACTIVE", { item: item.name });
    }
  }

  private async replaceChildren(tx: Tx, supplierId: string, contacts: Array<SupplierContactInput & { isPrimary: boolean }>, items: SupplierItemInput[]) {
    await this.createContacts(tx, supplierId, contacts);
    await this.replaceItems(tx, supplierId, items);
  }

  private async createContacts(tx: Tx, supplierId: string, contacts: Array<SupplierContactInput & { isPrimary: boolean }>) {
    if (contacts.length === 0) return;
    await tx.supplierContact.createMany({
      data: contacts.map((c, i) => ({
        supplierId,
        name: c.name,
        position: c.position ?? null,
        phone: c.phone ?? null,
        email: c.email ?? null,
        isPrimary: c.isPrimary,
        notes: c.notes ?? null,
        sortOrder: i,
      })),
    });
  }

  /**
   * Reemplaza los artículos que surte conservando la historia de precios: los
   * que siguen se actualizan (sin perder `lastPurchasedAt`), los nuevos se crean
   * y los que ya no vienen se quitan.
   */
  private async replaceItems(tx: Tx, supplierId: string, items: SupplierItemInput[]) {
    const keep = items.map((i) => i.itemId);
    await tx.supplierItem.deleteMany({ where: { supplierId, itemId: { notIn: keep } } });
    for (const i of items) {
      const data = {
        supplierCode: i.supplierCode ?? null,
        purchaseUnit: i.purchaseUnit,
        factor: new Prisma.Decimal(i.factor.toFixed(3)),
        ...(i.lastUnitCost !== undefined && { lastUnitCost: i.lastUnitCost === null ? null : new Prisma.Decimal(i.lastUnitCost) }),
      };
      await tx.supplierItem.upsert({
        where: { supplierId_itemId: { supplierId, itemId: i.itemId } },
        update: data,
        create: { supplierId, itemId: i.itemId, ...data },
      });
    }
  }
}
