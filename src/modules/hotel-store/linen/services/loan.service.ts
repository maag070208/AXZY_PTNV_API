import { randomUUID } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import { prismaClient } from "@core/config/database";
import { HttpError } from "@core/middlewares/error.middleware";
import type { AuditLogger } from "@modules/users/services/user.service";
import {
  filterDateRange,
  filterEnum,
  filterId,
  filterText,
  orderByOf,
  type ITDataTableFetchParams,
} from "@core/utils/table";
import { assertMovementShape } from "../../services/kardex-rules";
import type { HotelMovementService } from "../../services/movement.service";
import type { HotelLoanCreateInput, HotelLoanReturnInput } from "../models/dto/loan.dto";
import { locationIdsOf, runSerializable, warehouseOfKind } from "./linen-locations";
import {
  TOWEL_DEPOSIT_KEY,
  assertReturnQuantity,
  depositOf,
  depositSplit,
  depositsByMethod,
  isOpenLoan,
  parseTowelDeposit,
  statusAfterReturn,
} from "./loan-rules";

export const LOAN_DOC = "HOTEL_TOWEL_LOAN";
const STATUSES = ["OPEN", "PARTIAL", "RETURNED", "UNRETURNED"] as const;
const WAREHOUSE_SELECT = { id: true, code: true, name: true, kind: true } as const;
const LOAN_INCLUDE = {
  pointWarehouse: { select: WAREHOUSE_SELECT },
  product: { select: { id: true, code: true, name: true, size: true } },
  lentBy: { select: { id: true, name: true } },
  returnedBy: { select: { id: true, name: true } },
} as const;

type LoanRow = Prisma.HotelTowelLoanGetPayload<{ include: typeof LOAN_INCLUDE }>;

/** Vista de un préstamo con sus importes ya calculados. */
export const loanView = (l: LoanRow) => {
  const quantity = Number(l.quantity);
  const returnedQty = Number(l.returnedQty);
  const depositUnit = Number(l.depositUnit);
  const split = depositSplit({ quantity, returnedQty, depositUnit });
  return {
    id: l.id,
    folio: l.folio,
    point: l.pointWarehouse,
    product: l.product,
    quantity,
    returnedQty,
    pendingQty: Math.max(0, quantity - returnedQty),
    guestName: l.guestName,
    room: l.room,
    visitorId: l.visitorId,
    depositUnit,
    depositMethod: l.depositMethod,
    depositCollected: split.collected,
    depositReturned: split.returned,
    depositHeld: l.status === "UNRETURNED" ? 0 : split.held,
    depositRetained: l.status === "UNRETURNED" ? split.held : 0,
    status: l.status,
    lentBy: l.lentBy,
    lentAt: l.lentAt,
    returnedBy: l.returnedBy,
    returnedAt: l.returnedAt,
    shiftCloseId: l.shiftCloseId,
    notes: l.notes,
  };
};

/**
 * Préstamo de toallas en un punto (Etapa 2, pasos 10-11): saca del GENERAL del punto a LENT
 * (LOAN_OUT), cobra un depósito por toalla (`sys_config.HOTEL_TOWEL_DEPOSIT`) y al devolver
 * regresa a DIRTY del punto (LOAN_RETURN) reembolsando lo devuelto; se permite devolución parcial.
 */
export class HotelLoanService {
  constructor(
    private readonly db: PrismaClient = prismaClient,
    private readonly movements: HotelMovementService,
    private readonly audit?: AuditLogger
  ) {}

  /** Depósito vigente por toalla. */
  async depositUnit(): Promise<number> {
    const row = await this.db.sysConfig.findUnique({ where: { key: TOWEL_DEPOSIT_KEY }, select: { value: true } });
    return parseTowelDeposit(row?.value);
  }

  async create(input: HotelLoanCreateInput, actorId: string) {
    const point = await warehouseOfKind(this.db, "POINT", input.warehouseId, "HOTEL_LOAN_POINT_INVALID");
    const product = await this.db.hotelProduct.findUnique({ where: { id: input.productId }, select: { id: true, kind: true, active: true } });
    if (!product) throw new HttpError(404, "HOTEL_PRODUCT_NOT_FOUND");
    if (product.kind !== "LINEN" || !product.active) throw new HttpError(422, "HOTEL_LOAN_PRODUCT_INVALID");
    const depositUnit = await this.depositUnit();
    const locations = await locationIdsOf(this.db, point.id);
    const general = locations.get("GENERAL");
    const lent = locations.get("LENT");
    if (!general || !lent) throw new HttpError(422, "HOTEL_LOCATION_NOT_IN_WAREHOUSE", { code: general ? "LENT" : "GENERAL" });

    const id = randomUUID();
    const created = await runSerializable(async (tx) => {
      const movementInput = {
        type: "LOAN_OUT" as const,
        fromWarehouseId: point.id,
        warehouseId: point.id,
        sourceDocType: LOAN_DOC,
        sourceDocId: id,
        notes: `Préstamo de toallas a ${input.guestName}`,
        lines: [{ productId: input.productId, quantity: input.quantity, fromLocationId: general, toLocationId: lent }],
      };
      assertMovementShape("LOAN_OUT", movementInput);
      await this.movements.applyInTransaction(tx, movementInput, actorId, null);
      const count = await tx.hotelTowelLoan.count();
      return tx.hotelTowelLoan.create({
        data: {
          id,
          folio: `VT-${String(count + 1).padStart(4, "0")}`,
          pointWarehouseId: point.id,
          productId: input.productId,
          quantity: input.quantity,
          guestName: input.guestName,
          room: input.room ?? null,
          visitorId: input.visitorId ?? null,
          depositUnit,
          depositMethod: input.depositMethod,
          lentById: actorId,
          notes: input.notes ?? null,
        },
        include: LOAN_INCLUDE,
      });
    }, this.db);
    await this.audit?.({
      action: "HOTEL_LINEN_LOAN_CREATED",
      entityType: "HotelTowelLoan",
      entityId: created.id,
      userId: actorId,
      newState: { folio: created.folio, point: point.id, quantity: input.quantity, deposit: depositOf(input.quantity, depositUnit), method: input.depositMethod },
    });
    return loanView(created);
  }

  /** Devuelve toallas (parcial permitido): LENT -> DIRTY del punto y reembolsa qty × depósito. */
  async returnLoan(folio: string, input: HotelLoanReturnInput, actorId: string) {
    const header = await this.header(folio);
    const locations = await locationIdsOf(this.db, header.pointWarehouseId);
    const lent = locations.get("LENT");
    const dirty = locations.get("DIRTY");
    if (!lent || !dirty) throw new HttpError(422, "HOTEL_LOCATION_NOT_IN_WAREHOUSE", { code: lent ? "DIRTY" : "LENT" });

    const result = await runSerializable(async (tx) => {
      const loan = await tx.hotelTowelLoan.findUniqueOrThrow({ where: { id: header.id } });
      if (!isOpenLoan(loan.status)) throw new HttpError(409, "HOTEL_LOAN_NOT_OPEN");
      const pending = Number(loan.quantity) - Number(loan.returnedQty);
      assertReturnQuantity(pending, input.quantity);
      const movementInput = {
        type: "LOAN_RETURN" as const,
        fromWarehouseId: loan.pointWarehouseId,
        warehouseId: loan.pointWarehouseId,
        sourceDocType: LOAN_DOC,
        sourceDocId: loan.id,
        notes: `Devolución de toallas ${loan.folio}`,
        lines: [{ productId: loan.productId, quantity: input.quantity, fromLocationId: lent, toLocationId: dirty }],
      };
      assertMovementShape("LOAN_RETURN", movementInput);
      await this.movements.applyInTransaction(tx, movementInput, actorId, null);
      const returnedQty = Number(loan.returnedQty) + input.quantity;
      const updated = await tx.hotelTowelLoan.update({
        where: { id: loan.id },
        data: {
          returnedQty,
          status: statusAfterReturn(Number(loan.quantity), returnedQty),
          returnedById: actorId,
          returnedAt: new Date(),
        },
        include: LOAN_INCLUDE,
      });
      return { updated, depositRefund: depositOf(input.quantity, Number(loan.depositUnit)) };
    }, this.db);
    await this.audit?.({
      action: "HOTEL_LINEN_LOAN_RETURNED",
      entityType: "HotelTowelLoan",
      entityId: header.id,
      userId: actorId,
      newState: { folio, quantity: input.quantity, status: result.updated.status, refund: result.depositRefund },
    });
    return { ...loanView(result.updated), depositRefund: result.depositRefund };
  }

  /** Cabecera mínima por folio (para validar el alcance del punto antes de operar). */
  async header(folio: string) {
    const loan = await this.db.hotelTowelLoan.findUnique({ where: { folio }, select: { id: true, pointWarehouseId: true, status: true } });
    if (!loan) throw new HttpError(404, "HOTEL_LOAN_NOT_FOUND");
    return loan;
  }

  async get(folio: string) {
    const loan = await this.db.hotelTowelLoan.findUnique({ where: { folio }, include: LOAN_INCLUDE });
    if (!loan) throw new HttpError(404, "HOTEL_LOAN_NOT_FOUND");
    return loanView(loan);
  }

  /** Tabla server-side. Filtros: status, warehouse (punto), folio, guest, date. */
  async table(params: ITDataTableFetchParams, visibleIds: string[] | null) {
    const f = params.filters;
    const status = filterEnum(f, "status", STATUSES);
    const warehouse = filterId(f, "warehouse");
    const where: Prisma.HotelTowelLoanWhereInput = {
      ...(status ? { status } : {}),
      ...(warehouse ? { pointWarehouseId: warehouse } : {}),
      ...(filterText(f, "folio") ? { folio: filterText(f, "folio") } : {}),
      ...(filterText(f, "guest") ? { guestName: filterText(f, "guest") } : {}),
      ...(filterDateRange(f, "date") ? { lentAt: filterDateRange(f, "date") } : {}),
      ...(visibleIds ? { AND: [{ pointWarehouseId: { in: visibleIds } }] } : {}),
    };
    const orderBy = orderByOf(params.sort, { folio: "folio", lentAt: "lentAt", status: "status" }, [{ lentAt: "desc" }]) as Prisma.HotelTowelLoanOrderByWithRelationInput[];
    const [rows, total] = await Promise.all([
      this.db.hotelTowelLoan.findMany({ where, orderBy, skip: (params.page - 1) * params.limit, take: params.limit, include: LOAN_INCLUDE }),
      this.db.hotelTowelLoan.count({ where }),
    ]);
    return { total, data: rows.map(loanView) };
  }

  /** Resumen del punto: toallas prestadas abiertas y depósito en caja por método. */
  async pointSummary(warehouseId: string) {
    const point = await warehouseOfKind(this.db, "POINT", warehouseId, "HOTEL_LOAN_POINT_INVALID");
    const open = await this.db.hotelTowelLoan.findMany({
      where: { pointWarehouseId: point.id, status: { in: ["OPEN", "PARTIAL"] } },
      select: { quantity: true, returnedQty: true, depositUnit: true, depositMethod: true },
    });
    const normalized = open.map((l) => ({
      depositMethod: l.depositMethod,
      quantity: Number(l.quantity),
      returnedQty: Number(l.returnedQty),
      depositUnit: Number(l.depositUnit),
    }));
    const deposits = depositsByMethod(normalized);
    const lastClose = await this.db.hotelShiftClose.findFirst({ where: { pointWarehouseId: point.id }, orderBy: { to: "desc" }, select: { to: true } });
    return {
      warehouse: await this.db.hotelWarehouse.findUnique({ where: { id: point.id }, select: WAREHOUSE_SELECT }),
      depositUnit: await this.depositUnit(),
      openLoans: open.length,
      lentPending: normalized.reduce((s, l) => s + l.quantity - l.returnedQty, 0),
      deposits,
      depositsTotal: deposits.CASH + deposits.CARD + deposits.ROOM_CHARGE,
      lastCloseAt: lastClose?.to ?? null,
    };
  }
}
