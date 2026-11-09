import { Prisma, type PrismaClient } from "@prisma/client";
import { prismaClient } from "@core/config/database";
import { HttpError } from "@core/middlewares/error.middleware";
import type { AuditLogger } from "@modules/users/services/user.service";
import {
  filterBool,
  filterDateRange,
  filterId,
  orderByOf,
  type ITDataTableFetchParams,
} from "@core/utils/table";
import type { HotelMovementService } from "../../services/movement.service";
import type { HotelShiftCloseInput } from "../models/dto/loan.dto";
import type { HotelSignatureService } from "./signature.service";
import { assertDifferentUsers } from "./transfer-rules";
import { locationIdsOf, runSerializable, warehouseOfKind } from "./linen-locations";
import { computeShiftClose } from "./loan-rules";
import { reportMissing } from "./loan-missing";

export const SHIFT_CLOSE_DOC = "HOTEL_SHIFT_CLOSE";
const WAREHOUSE_SELECT = { id: true, code: true, name: true, kind: true } as const;
const USER = { select: { id: true, name: true } } as const;

const view = (c: Prisma.HotelShiftCloseGetPayload<{ include: { pointWarehouse: { select: typeof WAREHOUSE_SELECT }; closedBy: typeof USER; receivedBy: typeof USER; reviewedBy: typeof USER } }>) => ({
  id: c.id,
  folio: c.folio,
  point: c.pointWarehouse,
  closedBy: c.closedBy,
  receivedBy: c.receivedBy,
  endOfDay: c.endOfDay,
  from: c.from,
  to: c.to,
  lent: Number(c.lent),
  returned: Number(c.returned),
  unreturned: Number(c.unreturned),
  depositsCollected: Number(c.depositsCollected),
  depositsReturned: Number(c.depositsReturned),
  depositsRetained: Number(c.depositsRetained),
  reviewedBy: c.reviewedBy,
  reviewedAt: c.reviewedAt,
  notes: c.notes,
  createdAt: c.createdAt,
});

const INCLUDE = { pointWarehouse: { select: WAREHOUSE_SELECT }, closedBy: USER, receivedBy: USER, reviewedBy: USER } as const;

/**
 * Corte de turno de un punto (Etapa 4, pasos 3-4): totaliza los préstamos aún sin cortar,
 * retiene el depósito de los marcados como no devueltos (baja pendiente motivo F desde LENT),
 * firma entrega (sesión) y recepción (co-firma del turno siguiente) y queda para revisión de Contabilidad.
 */
export class HotelShiftCloseService {
  constructor(
    private readonly db: PrismaClient = prismaClient,
    private readonly movements: HotelMovementService,
    private readonly signatures: HotelSignatureService,
    private readonly audit?: AuditLogger
  ) {}

  /** Vista previa de lo que cortaría hoy (sin escribir): totales con lo marcado. */
  async preview(warehouseId: string, markedIds: string[]) {
    const point = await warehouseOfKind(this.db, "POINT", warehouseId, "HOTEL_LOAN_POINT_INVALID");
    const loans = await this.pendingLoans(this.db, point.id);
    const plan = computeShiftClose(loans.map(this.toRuleLoan), markedIds);
    return { totals: plan.totals, included: plan.included.length, carriedOver: plan.carriedOver.length };
  }

  async create(input: HotelShiftCloseInput, actorId: string) {
    const point = await warehouseOfKind(this.db, "POINT", input.warehouseId, "HOTEL_LOAN_POINT_INVALID");
    const endOfDay = input.endOfDay === true;
    let receiverId: string | null = null;
    if (input.cosignToken) {
      receiverId = await this.signatures.resolveCosignUser(input.cosignToken);
      assertDifferentUsers([actorId], receiverId);
    } else if (!endOfDay) {
      throw new HttpError(422, "HOTEL_SHIFT_COSIGN_REQUIRED");
    }
    const lentLocation = (await locationIdsOf(this.db, point.id)).get("LENT");
    if (!lentLocation) throw new HttpError(422, "HOTEL_LOCATION_NOT_IN_WAREHOUSE", { code: "LENT" });

    const result = await runSerializable(async (tx) => {
      const loans = await this.pendingLoans(tx, point.id);
      const plan = computeShiftClose(loans.map(this.toRuleLoan), input.markUnreturned);
      if (plan.included.length === 0) throw new HttpError(422, "HOTEL_SHIFT_NOTHING_TO_CLOSE");
      const previous = await tx.hotelShiftClose.findFirst({ where: { pointWarehouseId: point.id }, orderBy: { to: "desc" }, select: { to: true } });
      const from = previous?.to ?? loans.reduce((min, l) => (l.lentAt < min ? l.lentAt : min), loans[0].lentAt);
      const count = await tx.hotelShiftClose.count();
      const close = await tx.hotelShiftClose.create({
        data: {
          folio: `CT-${String(count + 1).padStart(4, "0")}`,
          pointWarehouseId: point.id,
          closedById: actorId,
          receivedById: receiverId,
          endOfDay,
          from,
          to: new Date(),
          lent: plan.totals.lent,
          returned: plan.totals.returned,
          unreturned: plan.totals.unreturned,
          depositsCollected: plan.totals.depositsCollected,
          depositsReturned: plan.totals.depositsReturned,
          depositsRetained: plan.totals.depositsRetained,
          notes: input.notes ?? null,
        },
        include: INCLUDE,
      });
      const marked = new Set(plan.markedIds);
      for (const loan of plan.included) {
        const isMarked = marked.has(loan.id);
        await tx.hotelTowelLoan.update({
          where: { id: loan.id },
          data: { shiftCloseId: close.id, ...(isMarked ? { status: "UNRETURNED" as const } : {}) },
        });
        if (isMarked) {
          // El faltante sale de LENT como baja pendiente motivo F.
          const source = loans.find((l) => l.id === loan.id)!;
          await reportMissing(tx, {
            warehouseId: point.id,
            locationId: lentLocation,
            productId: source.productId,
            quantity: loan.quantity - loan.returnedQty,
            actorId,
            sourceDocId: close.id,
            notes: `Toallas no devueltas ${source.folio} (corte ${close.folio})`,
            movements: this.movements,
          });
        }
      }
      await this.signatures.sign(SHIFT_CLOSE_DOC, close.id, "DELIVERS", actorId, "SESSION", tx);
      if (receiverId) await this.signatures.sign(SHIFT_CLOSE_DOC, close.id, "RECEIVES", receiverId, "PASSWORD", tx);
      return { close, totals: plan.totals, carriedOver: plan.carriedOver.length };
    }, this.db);
    await this.audit?.({
      action: "HOTEL_LINEN_SHIFT_CLOSED",
      entityType: "HotelShiftClose",
      entityId: result.close.id,
      userId: actorId,
      newState: { folio: result.close.folio, point: point.id, receivedBy: receiverId, endOfDay, ...result.totals },
    });
    return { ...view(result.close), carriedOver: result.carriedOver };
  }

  /** Revisión de Contabilidad: firma REVIEWS (distinta de quien cerró el turno). */
  async review(id: string, actorId: string) {
    const close = await this.db.hotelShiftClose.findUnique({ where: { id }, select: { id: true, folio: true, closedById: true, reviewedAt: true } });
    if (!close) throw new HttpError(404, "HOTEL_SHIFT_CLOSE_NOT_FOUND");
    if (close.reviewedAt) throw new HttpError(409, "HOTEL_SHIFT_ALREADY_REVIEWED");
    assertDifferentUsers([close.closedById], actorId);
    await runSerializable(async (tx) => {
      await tx.hotelShiftClose.update({ where: { id }, data: { reviewedById: actorId, reviewedAt: new Date() } });
      await this.signatures.sign(SHIFT_CLOSE_DOC, id, "REVIEWS", actorId, "SESSION", tx);
    }, this.db);
    await this.audit?.({ action: "HOTEL_LINEN_SHIFT_REVIEWED", entityType: "HotelShiftClose", entityId: id, userId: actorId, newState: { folio: close.folio } });
    return this.get(id);
  }

  async header(id: string) {
    const close = await this.db.hotelShiftClose.findUnique({ where: { id }, select: { id: true, pointWarehouseId: true } });
    if (!close) throw new HttpError(404, "HOTEL_SHIFT_CLOSE_NOT_FOUND");
    return close;
  }

  async get(id: string) {
    const close = await this.db.hotelShiftClose.findUnique({
      where: { id },
      include: {
        ...INCLUDE,
        loans: { include: { product: { select: { id: true, code: true, name: true } } }, orderBy: { lentAt: "asc" } },
      },
    });
    if (!close) throw new HttpError(404, "HOTEL_SHIFT_CLOSE_NOT_FOUND");
    const signatures = await this.signatures.list(SHIFT_CLOSE_DOC, id);
    return {
      ...view(close),
      loans: close.loans.map((l) => ({
        id: l.id,
        folio: l.folio,
        product: l.product,
        guestName: l.guestName,
        room: l.room,
        quantity: Number(l.quantity),
        returnedQty: Number(l.returnedQty),
        depositUnit: Number(l.depositUnit),
        depositMethod: l.depositMethod,
        status: l.status,
      })),
      signatures: signatures.map((s) => ({ role: s.role, method: s.method, signedAt: s.signedAt, user: s.user })),
    };
  }

  /** Tabla server-side. Filtros: warehouse (punto), reviewed (bool), date. */
  async table(params: ITDataTableFetchParams, visibleIds: string[] | null) {
    const f = params.filters;
    const warehouse = filterId(f, "warehouse");
    const reviewed = filterBool(f, "reviewed");
    const where: Prisma.HotelShiftCloseWhereInput = {
      ...(warehouse ? { pointWarehouseId: warehouse } : {}),
      ...(reviewed !== undefined ? { reviewedAt: reviewed ? { not: null } : null } : {}),
      ...(filterDateRange(f, "date") ? { to: filterDateRange(f, "date") } : {}),
      ...(visibleIds ? { AND: [{ pointWarehouseId: { in: visibleIds } }] } : {}),
    };
    const orderBy = orderByOf(params.sort, { folio: "folio", to: "to" }, [{ to: "desc" }]) as Prisma.HotelShiftCloseOrderByWithRelationInput[];
    const [rows, total] = await Promise.all([
      this.db.hotelShiftClose.findMany({ where, orderBy, skip: (params.page - 1) * params.limit, take: params.limit, include: INCLUDE }),
      this.db.hotelShiftClose.count({ where }),
    ]);
    return { total, data: rows.map(view) };
  }

  /** Préstamos del punto que todavía no entran a ningún corte. */
  private pendingLoans(db: PrismaClient | Prisma.TransactionClient, pointWarehouseId: string) {
    return db.hotelTowelLoan.findMany({
      where: { pointWarehouseId, shiftCloseId: null },
      select: { id: true, folio: true, productId: true, status: true, quantity: true, returnedQty: true, depositUnit: true, lentAt: true },
      orderBy: { lentAt: "asc" },
    });
  }

  private toRuleLoan = (l: { id: string; status: "OPEN" | "PARTIAL" | "RETURNED" | "UNRETURNED"; quantity: Prisma.Decimal; returnedQty: Prisma.Decimal; depositUnit: Prisma.Decimal }) => ({
    id: l.id,
    status: l.status,
    quantity: Number(l.quantity),
    returnedQty: Number(l.returnedQty),
    depositUnit: Number(l.depositUnit),
  });
}
