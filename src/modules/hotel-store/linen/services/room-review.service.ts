import { Prisma, type PrismaClient } from "@prisma/client";
import { prismaClient } from "@core/config/database";
import { HttpError } from "@core/middlewares/error.middleware";
import type { AuditLogger } from "@modules/users/services/user.service";
import { filterBool, filterDateRange, filterId, filterText, orderByOf, type ITDataTableFetchParams } from "@core/utils/table";
import type { HotelRoomReviewCreateInput } from "../models/dto/room-review.dto";
import { runSerializable } from "./linen-locations";
import { notifyUsers, userIdsByRoles, type Notifier } from "./extra-recipients";
import { expectedForRoom } from "./room-par-rules";
import { buildReviewLines, consolidate, reviewTotals, validateCounted } from "./room-review-rules";

/** Rol al que se avisa cuando una revisión trae faltantes. */
export const REVIEW_NOTIFY_ROLES = ["HOTEL_GENERAL_SUPERVISOR"];

const PRODUCT_SELECT = { id: true, code: true, name: true, size: true } as const;
const INCLUDE = {
  room: { select: { id: true, number: true, zoneId: true, zone: { select: { id: true, name: true } } } },
  reviewedBy: { select: { id: true, name: true } },
  responsible: { select: { id: true, name: true } },
  lines: { include: { product: { select: PRODUCT_SELECT } } },
} as const;
type ReviewRow = Prisma.HotelRoomReviewGetPayload<{ include: typeof INCLUDE }>;

const view = (r: ReviewRow) => ({
  id: r.id,
  folio: r.folio,
  room: r.room,
  reviewedBy: r.reviewedBy,
  responsible: r.responsible,
  shift: r.shift,
  reviewedAt: r.reviewedAt,
  notes: r.notes,
  totals: { expected: r.totalExpected, counted: r.totalCounted, missing: r.totalMissing, surplus: r.totalSurplus },
  lines: [...r.lines]
    .sort((a, b) => a.product.code.localeCompare(b.product.code))
    .map((l) => ({ product: l.product, expected: l.expected, counted: l.counted, diff: l.diff, unexpected: l.unexpected })),
});

/** Revisión de habitación: contado contra el esperado de la dotación de blancos. */
export class HotelRoomReviewService {
  constructor(
    private readonly db: PrismaClient = prismaClient,
    private readonly audit?: AuditLogger,
    private readonly notifications?: Notifier
  ) {}

  /** Zona de la habitación (para validar el alcance antes de operar). */
  async roomZone(roomId: string): Promise<string> {
    const room = await this.db.hotelRoom.findUnique({ where: { id: roomId }, select: { zoneId: true } });
    if (!room) throw new HttpError(404, "HOTEL_ROOM_NOT_FOUND");
    return room.zoneId;
  }

  async create(input: HotelRoomReviewCreateInput, actorId: string) {
    const invalid = validateCounted(input.lines);
    if (invalid) throw new HttpError(400, invalid.code, { index: invalid.index });

    const room = await this.db.hotelRoom.findUnique({ where: { id: input.roomId } });
    if (!room || !room.active) throw new HttpError(404, "HOTEL_ROOM_NOT_FOUND");
    const pars = await this.db.hotelRoomPar.findMany({ where: { product: { kind: "LINEN" } } });
    if (pars.length === 0) throw new HttpError(409, "HOTEL_ROOM_PAR_EMPTY");
    const expected = expectedForRoom({ kingBeds: room.kingBeds, queenBeds: room.queenBeds, sofaBeds: room.sofaBeds, bathrooms: room.bathrooms }, pars);

    const responsible = await this.db.user.findUnique({ where: { id: input.responsibleId }, select: { id: true, active: true } });
    if (!responsible || !responsible.active) throw new HttpError(400, "HOTEL_ROOM_REVIEW_RESPONSIBLE_INVALID");

    // Los artículos contados deben ser blancos activos.
    const countedIds = input.lines.map((l) => l.productId);
    const products = await this.db.hotelProduct.findMany({ where: { id: { in: countedIds } }, select: { id: true, kind: true, active: true } });
    const byId = new Map(products.map((p) => [p.id, p]));
    for (const id of countedIds) {
      const p = byId.get(id);
      if (!p || !p.active || p.kind !== "LINEN") throw new HttpError(400, "HOTEL_ROOM_REVIEW_PRODUCT_INVALID", { productId: id });
    }

    const lines = buildReviewLines(expected, input.lines);
    const totals = reviewTotals(lines);
    const created = await runSerializable(async (tx) => {
      const count = await tx.hotelRoomReview.count();
      return tx.hotelRoomReview.create({
        data: {
          folio: `RV-${String(count + 1).padStart(4, "0")}`,
          roomId: room.id,
          reviewedById: actorId,
          responsibleId: responsible.id,
          shift: input.shift,
          notes: input.notes ?? null,
          totalExpected: totals.expected,
          totalCounted: totals.counted,
          totalMissing: totals.missing,
          totalSurplus: totals.surplus,
          lines: { create: lines },
        },
        include: INCLUDE,
      });
    }, this.db);

    await this.audit?.({
      action: "HOTEL_LINEN_ROOM_REVIEWED",
      entityType: "HotelRoomReview",
      entityId: created.id,
      userId: actorId,
      newState: { folio: created.folio, room: room.id, responsible: responsible.id, shift: input.shift, ...totals },
    });
    if (totals.missing > 0) {
      await notifyUsers(
        this.notifications,
        await userIdsByRoles(this.db, REVIEW_NOTIFY_ROLES),
        {
          type: "HOTEL_LINEN_ROOM_REVIEW_MISSING",
          title: `Faltantes en la habitación ${room.number}`,
          detail: `${created.folio}: ${totals.missing} pieza(s) faltantes`,
        },
        actorId
      );
    }
    return view(created);
  }

  async get(id: string) {
    const review = await this.db.hotelRoomReview.findUnique({ where: { id }, include: INCLUDE });
    if (!review) throw new HttpError(404, "HOTEL_ROOM_REVIEW_NOT_FOUND");
    return view(review);
  }

  /** Zona de la habitación de la revisión (para validar el alcance). */
  async zoneOfReview(id: string): Promise<string> {
    const review = await this.db.hotelRoomReview.findUnique({ where: { id }, select: { room: { select: { zoneId: true } } } });
    if (!review) throw new HttpError(404, "HOTEL_ROOM_REVIEW_NOT_FOUND");
    return review.room.zoneId;
  }

  /** Historial de una habitación, de la más reciente a la más antigua. */
  async history(roomId: string, limit = 50) {
    const rows = await this.db.hotelRoomReview.findMany({ where: { roomId }, include: INCLUDE, orderBy: { reviewedAt: "desc" }, take: limit });
    return rows.map(view);
  }

  /** Tabla server-side. Filtros: folio, room, zone, responsible, date, withDifference. `zoneIds` null = todas. */
  async table(params: ITDataTableFetchParams, zoneIds: Set<string> | null) {
    const f = params.filters;
    const folio = filterText(f, "folio");
    const room = filterId(f, "room");
    const zone = filterId(f, "zone");
    const responsible = filterId(f, "responsible");
    const date = filterDateRange(f, "date");
    const withDifference = filterBool(f, "withDifference");
    const zoneFilter: Prisma.HotelRoomWhereInput = {
      ...(zone ? { zoneId: zone } : {}),
      ...(zoneIds ? { zoneId: { in: [...zoneIds] } } : {}),
    };
    const where: Prisma.HotelRoomReviewWhereInput = {
      ...(folio ? { folio: folio } : {}),
      ...(room ? { roomId: room } : {}),
      ...(responsible ? { responsibleId: responsible } : {}),
      ...(date ? { reviewedAt: date } : {}),
      ...(withDifference ? { OR: [{ totalMissing: { gt: 0 } }, { totalSurplus: { gt: 0 } }] } : {}),
      ...(Object.keys(zoneFilter).length > 0 ? { room: zoneFilter } : {}),
    };
    // Con `zone` y alcance a la vez, ambos deben cumplirse.
    if (zone && zoneIds) where.room = { AND: [{ zoneId: zone }, { zoneId: { in: [...zoneIds] } }] };
    const orderBy = orderByOf(
      params.sort,
      { folio: "folio", reviewedAt: "reviewedAt", missing: "totalMissing", surplus: "totalSurplus" },
      [{ reviewedAt: "desc" }]
    ) as Prisma.HotelRoomReviewOrderByWithRelationInput[];
    const [rows, total] = await Promise.all([
      this.db.hotelRoomReview.findMany({ where, orderBy, skip: (params.page - 1) * params.limit, take: params.limit, include: INCLUDE }),
      this.db.hotelRoomReview.count({ where }),
    ]);
    return { total, data: rows.map(view) };
  }

  /** Consolidado del periodo por artículo y por responsable. `zoneIds` null = todas. */
  async consolidated(from: Date, to: Date, zoneId: string | undefined, zoneIds: Set<string> | null) {
    const roomWhere: Prisma.HotelRoomWhereInput = {
      ...(zoneId ? { zoneId } : {}),
      ...(zoneIds ? { zoneId: { in: [...zoneIds] } } : {}),
    };
    if (zoneId && zoneIds) roomWhere.AND = [{ zoneId }, { zoneId: { in: [...zoneIds] } }];
    if (zoneId && zoneIds) delete roomWhere.zoneId;
    const rows = await this.db.hotelRoomReviewLine.findMany({
      where: { review: { reviewedAt: { gte: from, lte: to }, ...(Object.keys(roomWhere).length > 0 ? { room: roomWhere } : {}) } },
      select: { reviewId: true, productId: true, expected: true, counted: true, review: { select: { responsibleId: true } } },
    });
    const result = consolidate(rows.map((r) => ({ reviewId: r.reviewId, responsibleId: r.review.responsibleId, productId: r.productId, expected: r.expected, counted: r.counted })));
    const [products, users, reviews] = await Promise.all([
      this.db.hotelProduct.findMany({ where: { id: { in: result.byProduct.map((p) => p.productId) } }, select: PRODUCT_SELECT }),
      this.db.user.findMany({ where: { id: { in: result.byResponsible.map((r) => r.responsibleId) } }, select: { id: true, name: true } }),
      this.db.hotelRoomReview.count({ where: { reviewedAt: { gte: from, lte: to }, ...(Object.keys(roomWhere).length > 0 ? { room: roomWhere } : {}) } }),
    ]);
    const productById = new Map(products.map((p) => [p.id, p]));
    const userById = new Map(users.map((u) => [u.id, u]));
    return {
      from,
      to,
      reviews,
      byProduct: result.byProduct
        .map(({ productId, ...rest }) => ({ product: productById.get(productId)!, ...rest }))
        .sort((a, b) => b.missing - a.missing || a.product.code.localeCompare(b.product.code)),
      byResponsible: result.byResponsible
        .map(({ responsibleId, ...rest }) => ({ responsible: userById.get(responsibleId)!, ...rest }))
        .sort((a, b) => b.missing - a.missing || a.responsible.name.localeCompare(b.responsible.name)),
    };
  }
}
