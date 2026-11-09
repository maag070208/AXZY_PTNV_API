import { Prisma, type PrismaClient } from "@prisma/client";
import { prismaClient } from "@core/config/database";
import { HttpError } from "@core/middlewares/error.middleware";
import type { AuditLogger } from "@modules/users/services/user.service";
import {
  filterEnum,
  filterId,
  filterText,
  orderByOf,
  type ITDataTableFetchParams,
} from "@core/utils/table";
import type {
  HotelEquipmentDeliverInput,
  HotelEquipmentLoanCreateInput,
  HotelEquipmentReturnInput,
  HotelEquipmentUnitPatchInput,
  HotelEquipmentUnitsCreateInput,
} from "../models/dto/equipment.dto";
import type { HotelSignatureService } from "./signature.service";
import { runSerializable, warehouseOfKind } from "./linen-locations";
import { notifyUsers, userIdsByRoles, zoneSupervisorIds, type Notifier } from "./extra-recipients";
import {
  assertAvailable,
  assertManualTransition,
  assertRepairable,
  nextTags,
  statusAfterReturn,
} from "./equipment-rules";

export const EQUIPMENT_LOAN_DOC = "HOTEL_EQUIPMENT_LOAN";
const RECEPTION_ROLES = ["RECEPCION"];
const STATUSES = ["AVAILABLE", "LOANED", "IN_REPAIR", "MISSING", "RETIRED"] as const;

/** Puerto mínimo hacia el módulo de tickets (se inyecta; el hotel no importa su implementación). */
export interface EquipmentTicketPort {
  createTicket(data: {
    title: string;
    description: string;
    priority?: string;
    categoryId?: string;
    createdById: string;
  }): Promise<{ id: string }>;
}

const UNIT_INCLUDE = {
  product: { select: { id: true, code: true, name: true, tagPrefix: true } },
  warehouse: { select: { id: true, code: true, name: true } },
} as const;
const LOAN_INCLUDE = {
  unit: { select: { id: true, tag: true, status: true, product: { select: { id: true, code: true, name: true } } } },
  room: { select: { id: true, number: true, status: true, zone: { select: { id: true, name: true } } } },
  requestedBy: { select: { id: true, name: true } },
  deliveredBy: { select: { id: true, name: true } },
  returnedBy: { select: { id: true, name: true } },
} as const;
type LoanRow = Prisma.HotelEquipmentLoanGetPayload<{ include: typeof LOAN_INCLUDE }>;

const loanView = (l: LoanRow) => ({
  id: l.id,
  unit: l.unit,
  room: l.room,
  requestedBy: l.requestedBy,
  requestedAt: l.requestedAt,
  deliveredBy: l.deliveredBy,
  deliveredAt: l.deliveredAt,
  returnedAt: l.returnedAt,
  returnedBy: l.returnedBy,
  condition: l.condition,
  chargeAmount: l.chargeAmount === null ? null : Number(l.chargeAmount),
  ticketId: l.ticketId,
  notes: l.notes,
});

/**
 * Equipos por pieza (D18): etiqueta única (SEC-001), préstamo a habitación con prueba de
 * funcionamiento y devolución con estado B/D/F. NO usan HotelStock ni el ledger: el control es
 * por pieza (`hotel_equipment_units.status`), así que no hay movimientos de kardex.
 */
export class HotelEquipmentService {
  constructor(
    private readonly db: PrismaClient = prismaClient,
    private readonly signatures: HotelSignatureService,
    private readonly audit?: AuditLogger,
    private readonly notifications?: Notifier,
    private readonly tickets?: EquipmentTicketPort
  ) {}

  // ── Piezas ───────────────────────────────────────────────────────────────

  /** Alta de N piezas con etiquetas consecutivas del prefijo del producto. */
  async createUnits(input: HotelEquipmentUnitsCreateInput, actorId: string) {
    const product = await this.db.hotelProduct.findUnique({ where: { id: input.productId }, select: { id: true, kind: true, active: true, tagPrefix: true } });
    if (!product) throw new HttpError(404, "HOTEL_PRODUCT_NOT_FOUND");
    if (product.kind !== "EQUIPMENT" || !product.active) throw new HttpError(422, "HOTEL_EQUIPMENT_PRODUCT_INVALID");
    const prefix = product.tagPrefix?.trim();
    if (!prefix) throw new HttpError(422, "HOTEL_EQUIPMENT_TAG_PREFIX_REQUIRED");
    const warehouse = await warehouseOfKind(this.db, "EQUIPMENT", input.warehouseId ?? null, "HOTEL_EQUIPMENT_WAREHOUSE_NOT_CONFIGURED");

    const created = await runSerializable(async (tx) => {
      const existing = await tx.hotelEquipmentUnit.findMany({ where: { tag: { startsWith: `${prefix}-` } }, select: { tag: true } });
      const tags = nextTags(prefix, existing.map((e) => e.tag), input.quantity);
      await tx.hotelEquipmentUnit.createMany({
        data: tags.map((tag) => ({ tag, productId: product.id, warehouseId: warehouse.id, notes: input.notes ?? null })),
      });
      return tx.hotelEquipmentUnit.findMany({ where: { tag: { in: tags } }, include: UNIT_INCLUDE, orderBy: { tag: "asc" } });
    }, this.db);
    await this.audit?.({
      action: "HOTEL_LINEN_EQUIPMENT_UNITS_CREATED",
      entityType: "HotelEquipmentUnit",
      entityId: created[0]?.id ?? product.id,
      userId: actorId,
      newState: { product: product.id, tags: created.map((u) => u.tag) },
    });
    return created.map((u) => this.unitView(u));
  }

  /** Lista de piezas (selectores). Filtros: status, productId, q (etiqueta). */
  async listUnits(filters: { status?: (typeof STATUSES)[number]; productId?: string; q?: string }) {
    const rows = await this.db.hotelEquipmentUnit.findMany({
      where: {
        ...(filters.status ? { status: filters.status } : {}),
        ...(filters.productId ? { productId: filters.productId } : {}),
        ...(filters.q ? { tag: { contains: filters.q, mode: "insensitive" } } : {}),
      },
      include: UNIT_INCLUDE,
      orderBy: { tag: "asc" },
      take: 500,
    });
    return rows.map((u) => this.unitView(u));
  }

  /** Tabla server-side. Filtros: status, product, tag. */
  async unitTable(params: ITDataTableFetchParams) {
    const f = params.filters;
    const status = filterEnum(f, "status", STATUSES);
    const product = filterId(f, "product");
    const tag = filterText(f, "tag");
    const where: Prisma.HotelEquipmentUnitWhereInput = {
      ...(status ? { status } : {}),
      ...(product ? { productId: product } : {}),
      ...(tag ? { tag } : {}),
    };
    const orderBy = orderByOf(params.sort, { tag: "tag", status: "status" }, [{ tag: "asc" }]) as Prisma.HotelEquipmentUnitOrderByWithRelationInput[];
    const [rows, total] = await Promise.all([
      this.db.hotelEquipmentUnit.findMany({ where, orderBy, skip: (params.page - 1) * params.limit, take: params.limit, include: UNIT_INCLUDE }),
      this.db.hotelEquipmentUnit.count({ where }),
    ]);
    return { total, data: rows.map((u) => this.unitView(u)) };
  }

  /** Cambio manual: retirar o reactivar (y notas). */
  async patchUnit(id: string, input: HotelEquipmentUnitPatchInput, actorId: string) {
    const unit = await this.db.hotelEquipmentUnit.findUnique({ where: { id } });
    if (!unit) throw new HttpError(404, "HOTEL_EQUIPMENT_UNIT_NOT_FOUND");
    if (input.status && input.status !== unit.status) assertManualTransition(unit.status, input.status);
    const updated = await this.db.hotelEquipmentUnit.update({
      where: { id },
      data: { ...(input.status ? { status: input.status } : {}), ...(input.notes !== undefined ? { notes: input.notes } : {}) },
      include: UNIT_INCLUDE,
    });
    await this.audit?.({
      action: "HOTEL_LINEN_EQUIPMENT_UNIT_UPDATED",
      entityType: "HotelEquipmentUnit",
      entityId: id,
      userId: actorId,
      previousState: { status: unit.status },
      newState: { status: updated.status },
    });
    return this.unitView(updated);
  }

  /** La pieza reparada vuelve a estar disponible. */
  async repaired(id: string, actorId: string) {
    const unit = await this.db.hotelEquipmentUnit.findUnique({ where: { id } });
    if (!unit) throw new HttpError(404, "HOTEL_EQUIPMENT_UNIT_NOT_FOUND");
    assertRepairable(unit.status);
    const updated = await this.db.hotelEquipmentUnit.update({ where: { id }, data: { status: "AVAILABLE" }, include: UNIT_INCLUDE });
    await this.audit?.({ action: "HOTEL_LINEN_EQUIPMENT_REPAIRED", entityType: "HotelEquipmentUnit", entityId: id, userId: actorId, previousState: { status: "IN_REPAIR" }, newState: { status: "AVAILABLE" } });
    return this.unitView(updated);
  }

  // ── Préstamos ────────────────────────────────────────────────────────────

  async createLoan(input: HotelEquipmentLoanCreateInput, actorId: string) {
    const room = await this.db.hotelRoom.findUnique({ where: { id: input.roomId }, select: { id: true, number: true, zoneId: true, active: true } });
    if (!room || !room.active) throw new HttpError(404, "HOTEL_ROOM_NOT_FOUND");
    const created = await runSerializable(async (tx) => {
      const unit = await tx.hotelEquipmentUnit.findUnique({ where: { id: input.unitId }, include: { product: { select: { name: true } } } });
      if (!unit) throw new HttpError(404, "HOTEL_EQUIPMENT_UNIT_NOT_FOUND");
      assertAvailable(unit.status);
      await tx.hotelEquipmentUnit.update({ where: { id: unit.id }, data: { status: "LOANED" } });
      const loan = await tx.hotelEquipmentLoan.create({
        data: { unitId: unit.id, roomId: room.id, requestedById: actorId, notes: input.notes ?? null },
        include: LOAN_INCLUDE,
      });
      return { loan, unit };
    }, this.db);
    await this.audit?.({
      action: "HOTEL_LINEN_EQUIPMENT_LOANED",
      entityType: "HotelEquipmentLoan",
      entityId: created.loan.id,
      userId: actorId,
      newState: { unit: created.unit.tag, room: room.id },
    });
    await notifyUsers(
      this.notifications,
      await zoneSupervisorIds(this.db, room.zoneId),
      { type: "HOTEL_LINEN_EQUIPMENT", title: `Equipo ${created.unit.tag} para la habitación ${room.number}`, detail: created.unit.product.name },
      actorId
    );
    return loanView(created.loan);
  }

  /** Entrega con prueba de funcionamiento: firma quien lo lleva (cosign del auxiliar de piso, o la sesión). */
  async deliver(id: string, input: HotelEquipmentDeliverInput, actorId: string) {
    const delivererId = input.cosignToken ? await this.signatures.resolveCosignUser(input.cosignToken) : actorId;
    const method = input.cosignToken ? "PASSWORD" : "SESSION";
    await runSerializable(async (tx) => {
      const loan = await tx.hotelEquipmentLoan.findUnique({ where: { id }, select: { returnedAt: true, deliveredAt: true } });
      if (!loan) throw new HttpError(404, "HOTEL_EQUIPMENT_LOAN_NOT_FOUND");
      if (loan.returnedAt) throw new HttpError(409, "HOTEL_EQUIPMENT_LOAN_CLOSED");
      if (loan.deliveredAt) throw new HttpError(409, "HOTEL_EQUIPMENT_LOAN_DELIVERED");
      await tx.hotelEquipmentLoan.update({
        where: { id },
        data: { deliveredById: delivererId, deliveredAt: new Date(), ...(input.notes ? { notes: input.notes } : {}) },
      });
      await this.signatures.sign(EQUIPMENT_LOAN_DOC, id, "DELIVERS", delivererId, method, tx);
    }, this.db);
    await this.audit?.({ action: "HOTEL_LINEN_EQUIPMENT_DELIVERED", entityType: "HotelEquipmentLoan", entityId: id, userId: actorId, newState: { deliveredBy: delivererId } });
    return this.getLoan(id);
  }

  /** Retiro: B -> disponible; D -> en reparación + ticket de mantenimiento + aviso para el cargo; F -> extraviada + aviso. */
  async returnLoan(id: string, input: HotelEquipmentReturnInput, actorId: string) {
    if (input.condition !== "GOOD" && !input.notes?.trim()) throw new HttpError(422, "HOTEL_EQUIPMENT_NOTES_REQUIRED");
    const result = await runSerializable(async (tx) => {
      const loan = await tx.hotelEquipmentLoan.findUnique({
        where: { id },
        include: { unit: { include: { product: { select: { name: true } } } }, room: { select: { number: true } } },
      });
      if (!loan) throw new HttpError(404, "HOTEL_EQUIPMENT_LOAN_NOT_FOUND");
      if (loan.returnedAt) throw new HttpError(409, "HOTEL_EQUIPMENT_LOAN_CLOSED");
      await tx.hotelEquipmentLoan.update({
        where: { id },
        data: {
          returnedAt: new Date(),
          returnedById: actorId,
          condition: input.condition,
          chargeAmount: input.condition === "GOOD" ? null : (input.chargeAmount ?? null),
          ...(input.notes ? { notes: input.notes } : {}),
        },
      });
      await tx.hotelEquipmentUnit.update({ where: { id: loan.unitId }, data: { status: statusAfterReturn(input.condition) } });
      return { tag: loan.unit.tag, product: loan.unit.product.name, room: loan.room.number };
    }, this.db);

    let ticketId: string | null = null;
    if (input.condition === "DAMAGED") ticketId = await this.openRepairTicket(id, result, input.notes ?? null, actorId);
    await this.audit?.({
      action: "HOTEL_LINEN_EQUIPMENT_RETURNED",
      entityType: "HotelEquipmentLoan",
      entityId: id,
      userId: actorId,
      newState: { unit: result.tag, condition: input.condition, chargeAmount: input.chargeAmount ?? null, ticketId },
    });
    if (input.condition !== "GOOD") {
      const detail = input.condition === "DAMAGED" ? "dañado" : "no regresó";
      await notifyUsers(this.notifications, await userIdsByRoles(this.db, RECEPTION_ROLES), {
        type: "HOTEL_LINEN_EQUIPMENT_CHARGE",
        title: `Cargo por equipo ${result.tag} (${detail}) · hab. ${result.room}`,
        detail: input.chargeAmount ? `Monto sugerido: ${input.chargeAmount}` : result.product,
      });
    }
    return this.getLoan(id);
  }

  /** Zona de la habitación del préstamo (para validar el alcance antes de operar). */
  async zoneOfLoan(id: string): Promise<string> {
    const loan = await this.db.hotelEquipmentLoan.findUnique({ where: { id }, select: { room: { select: { zoneId: true } } } });
    if (!loan) throw new HttpError(404, "HOTEL_EQUIPMENT_LOAN_NOT_FOUND");
    return loan.room.zoneId;
  }

  async getLoan(id: string) {
    const loan = await this.db.hotelEquipmentLoan.findUnique({ where: { id }, include: LOAN_INCLUDE });
    if (!loan) throw new HttpError(404, "HOTEL_EQUIPMENT_LOAN_NOT_FOUND");
    return loanView(loan);
  }

  /** Tablero: habitaciones con equipo prestado (préstamos abiertos) y conteo de piezas por estado. */
  async board() {
    const [loans, counts] = await Promise.all([
      this.db.hotelEquipmentLoan.findMany({ where: { returnedAt: null }, include: LOAN_INCLUDE, orderBy: { requestedAt: "asc" } }),
      this.db.hotelEquipmentUnit.groupBy({ by: ["status"], _count: { _all: true } }),
    ]);
    const summary: Record<string, number> = { AVAILABLE: 0, LOANED: 0, IN_REPAIR: 0, MISSING: 0, RETIRED: 0 };
    for (const c of counts) summary[c.status] = c._count._all;
    return { loans: loans.map(loanView), summary };
  }

  /** Ticket de mantenimiento por el equipo dañado (falla de ticket no revierte la devolución). */
  private async openRepairTicket(loanId: string, info: { tag: string; product: string; room: string }, notes: string | null, actorId: string): Promise<string | null> {
    if (!this.tickets) return null;
    try {
      const category = await this.db.ticketCategory.findFirst({ where: { name: { equals: "Mantenimiento", mode: "insensitive" }, active: true }, select: { id: true } });
      const ticket = await this.tickets.createTicket({
        title: `Equipo dañado ${info.tag} (${info.product})`,
        description: `El equipo ${info.tag} regresó dañado de la habitación ${info.room}.${notes ? ` ${notes}` : ""}`,
        priority: "MEDIUM",
        ...(category ? { categoryId: category.id } : {}),
        createdById: actorId,
      });
      await this.db.hotelEquipmentLoan.update({ where: { id: loanId }, data: { ticketId: ticket.id } });
      return ticket.id;
    } catch {
      return null;
    }
  }

  private unitView(u: Prisma.HotelEquipmentUnitGetPayload<{ include: typeof UNIT_INCLUDE }>) {
    return { id: u.id, tag: u.tag, status: u.status, notes: u.notes, product: u.product, warehouse: u.warehouse, createdAt: u.createdAt };
  }
}
