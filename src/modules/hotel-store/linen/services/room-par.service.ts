import type { HotelProductKind, PrismaClient } from "@prisma/client";
import { prismaClient } from "@core/config/database";
import { HttpError } from "@core/middlewares/error.middleware";
import type { AuditLogger } from "@modules/users/services/user.service";
import type { HotelRoomParSaveInput } from "../models/dto/room-par.dto";
import { expectedForRoom, validateRoomParLines } from "./room-par-rules";

const PRODUCT_SELECT = { id: true, code: true, name: true, kind: true } as const;

/** Dotación por componente: matriz de blancos/amenidades y esperado por habitación. */
export class HotelRoomParService {
  constructor(
    private readonly db: PrismaClient = prismaClient,
    private readonly audit?: AuditLogger
  ) {}

  /** Renglones del `kind` y productos activos de ese `kind` para armar la matriz. */
  async list(kind: HotelProductKind) {
    const [lines, products] = await Promise.all([
      this.db.hotelRoomPar.findMany({
        where: { product: { kind } },
        include: { product: { select: PRODUCT_SELECT } },
        orderBy: [{ product: { code: "asc" } }, { component: "asc" }],
      }),
      this.db.hotelProduct.findMany({ where: { kind, active: true }, select: PRODUCT_SELECT, orderBy: { code: "asc" } }),
    ]);
    return {
      kind,
      lines: lines.map((l) => ({ component: l.component, productId: l.productId, quantity: l.quantity, product: l.product })),
      products,
    };
  }

  /** Reemplaza en una transacción solo los renglones de productos de ese `kind` (cantidad 0 = borrar). */
  async save(input: HotelRoomParSaveInput, actorId: string) {
    const errors = validateRoomParLines(input.lines);
    if (errors.length > 0) throw new HttpError(400, errors[0].code, { index: errors[0].index });

    const productIds = [...new Set(input.lines.map((l) => l.productId))];
    const products = await this.db.hotelProduct.findMany({ where: { id: { in: productIds } }, select: { id: true, kind: true, active: true } });
    const byId = new Map(products.map((p) => [p.id, p]));
    for (const id of productIds) {
      const product = byId.get(id);
      if (!product || !product.active || product.kind !== input.kind) {
        throw new HttpError(400, "HOTEL_ROOM_PAR_PRODUCT_INVALID", { productId: id });
      }
    }

    const toCreate = input.lines.filter((l) => l.quantity > 0);
    await this.db.$transaction(async (tx) => {
      await tx.hotelRoomPar.deleteMany({ where: { product: { kind: input.kind } } });
      if (toCreate.length > 0) {
        await tx.hotelRoomPar.createMany({
          data: toCreate.map((l) => ({ component: l.component, productId: l.productId, quantity: l.quantity })),
        });
      }
    });

    await this.audit?.({
      action: "HOTEL_LINEN_ROOM_PAR_UPDATED",
      entityType: "HotelRoomPar",
      entityId: input.kind,
      userId: actorId,
      newState: { kind: input.kind, lines: toCreate.length },
    });
    return { kind: input.kind, lines: toCreate.length };
  }

  /** Esperado de blancos de una habitación; 409 si no hay dotación de blancos. */
  async expectedForRoom(roomId: string) {
    const room = await this.db.hotelRoom.findUnique({
      where: { id: roomId },
      include: { zone: { select: { id: true, name: true } }, type: { select: { id: true, name: true } } },
    });
    if (!room) throw new HttpError(404, "HOTEL_ROOM_NOT_FOUND");
    const pars = await this.db.hotelRoomPar.findMany({
      where: { product: { kind: "LINEN" } },
      include: { product: { select: PRODUCT_SELECT } },
    });
    if (pars.length === 0) throw new HttpError(409, "HOTEL_ROOM_PAR_EMPTY");
    const composition = { kingBeds: room.kingBeds, queenBeds: room.queenBeds, sofaBeds: room.sofaBeds, bathrooms: room.bathrooms };
    const expected = expectedForRoom(composition, pars);
    const productById = new Map(pars.map((p) => [p.productId, p.product]));
    return {
      room: { id: room.id, number: room.number, zone: room.zone, type: room.type, ...composition },
      expected: [...expected.entries()]
        .map(([productId, quantity]) => ({ product: productById.get(productId)!, quantity }))
        .sort((a, b) => a.product.code.localeCompare(b.product.code)),
    };
  }
}
