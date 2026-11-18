import { Prisma, type HotelSignoffStatus, type PrismaClient } from "@prisma/client";
import { prismaClient } from "@core/config/database";
import { HttpError } from "@core/middlewares/error.middleware";
import type { AuditLogger } from "@modules/users/services/user.service";
import { filterDateRange, filterEnum, filterText, orderByOf, type ITDataTableFetchParams } from "@core/utils/table";
import type { HotelSignatureService } from "./signature.service";
import type { HotelTransferSignoffInput } from "../models/dto/signoff.dto";
import { notifyUsers, userIdsByRoles, type Notifier } from "./extra-recipients";
import { runSerializable } from "./linen-locations";
import { assertCanSignoff, assertSignoffNotes } from "./signoff-rules";
import { TRANSFER_DOC } from "./transfer.service";

/** Rol al que se avisa cuando la firma deja una diferencia. */
export const SIGNOFF_NOTIFY_ROLES = ["HOTEL_GENERAL_SUPERVISOR"];
/** Las diferencias cuentan como incidencia abierta durante este periodo. */
export const DIFFERENCE_WINDOW_DAYS = 30;

const STATUSES = ["PENDING", "CONFORM", "DIFFERENCE"] as const;
const WAREHOUSE_SELECT = { id: true, code: true, name: true, kind: true } as const;

/**
 * Contadores para el tablero: por firmar y diferencias recientes, sobre los almacenes de destino
 * visibles (`null` = todos).
 */
export const pendingSignoffs = async (db: PrismaClient, visibleIds: string[] | null, now: Date = new Date()) => {
  const scope = visibleIds ? { warehouseId: { in: visibleIds } } : {};
  const since = new Date(now.getTime() - DIFFERENCE_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const [pending, differences] = await Promise.all([
    db.hotelMovement.count({ where: { signoffStatus: "PENDING", ...scope } }),
    db.hotelMovement.count({ where: { signoffStatus: "DIFFERENCE", signoffAt: { gte: since }, ...scope } }),
  ]);
  return { pending, differences };
};

/**
 * 2ª firma en limpio a área (decisión 3: no bloquea stock). Los campos de conformidad viven en
 * `HotelMovement` (signoffStatus/ById/At/Notes) porque es 1:1 con el traspaso y así la bandeja y el
 * contador son una sola consulta; la firma queda además como HotelSignature CONFIRMS.
 */
export class HotelTransferSignoffService {
  constructor(
    private readonly db: PrismaClient = prismaClient,
    private readonly signatures: HotelSignatureService,
    private readonly audit?: AuditLogger,
    private readonly notifications?: Notifier
  ) {}

  /** Almacén de destino del traspaso (para validar el alcance antes de operar). */
  async destinationOf(id: string): Promise<string | null> {
    const m = await this.db.hotelMovement.findUnique({ where: { id }, select: { warehouseId: true } });
    if (!m) throw new HttpError(404, "HOTEL_TRANSFER_NOT_FOUND");
    return m.warehouseId;
  }

  async sign(id: string, input: HotelTransferSignoffInput, actorId: string) {
    assertSignoffNotes(input.result, input.notes);
    const notes = input.notes?.trim() || null;
    const folio = await runSerializable(async (tx) => {
      const m = await tx.hotelMovement.findUnique({ where: { id }, select: { id: true, folio: true, signoffStatus: true, receivedById: true } });
      if (!m) throw new HttpError(404, "HOTEL_TRANSFER_NOT_FOUND");
      assertCanSignoff(m, actorId);
      await this.signatures.sign(TRANSFER_DOC, id, "CONFIRMS", actorId, "SESSION", tx, notes);
      await tx.hotelMovement.update({
        where: { id },
        data: { signoffStatus: input.result as HotelSignoffStatus, signoffById: actorId, signoffAt: new Date(), signoffNotes: notes },
      });
      return m.folio;
    }, this.db);
    await this.audit?.({
      action: "HOTEL_LINEN_TRANSFER_SIGNED_OFF",
      entityType: "HotelMovement",
      entityId: id,
      userId: actorId,
      previousState: { signoffStatus: "PENDING" },
      newState: { signoffStatus: input.result, folio, notes },
    });
    if (input.result === "DIFFERENCE") {
      await notifyUsers(
        this.notifications,
        await userIdsByRoles(this.db, SIGNOFF_NOTIFY_ROLES),
        { type: "HOTEL_LINEN_SIGNOFF_DIFFERENCE", title: `Diferencia al firmar ${folio}`, detail: notes ?? undefined },
        actorId
      );
    }
    return this.get(id);
  }

  /** Detalle de la firma: estado, quién contó y quién firmó. */
  async get(id: string) {
    const m = await this.db.hotelMovement.findUnique({
      where: { id },
      include: { receivedBy: { select: { id: true, name: true } }, signoffBy: { select: { id: true, name: true } } },
    });
    if (!m) throw new HttpError(404, "HOTEL_TRANSFER_NOT_FOUND");
    return {
      id: m.id,
      folio: m.folio,
      signoffStatus: m.signoffStatus,
      signoffBy: m.signoffBy,
      signoffAt: m.signoffAt,
      signoffNotes: m.signoffNotes,
      receivedBy: m.receivedBy,
    };
  }

  /** Bandeja server-side. Filtros: status (PENDING|CONFORM|DIFFERENCE), folio, date. `visibleIds` null = todos. */
  async table(params: ITDataTableFetchParams, visibleIds: string[] | null) {
    const f = params.filters;
    const status = filterEnum(f, "status", STATUSES);
    const folio = filterText(f, "folio");
    const date = filterDateRange(f, "date");
    const where: Prisma.HotelMovementWhereInput = {
      signoffStatus: status ?? { not: null },
      ...(folio ? { folio } : {}),
      ...(date ? { receivedAt: date } : {}),
      ...(visibleIds ? { warehouseId: { in: visibleIds } } : {}),
    };
    const orderBy = orderByOf(params.sort, { folio: "folio", receivedAt: "receivedAt", status: "signoffStatus" }, [{ receivedAt: "desc" }]) as Prisma.HotelMovementOrderByWithRelationInput[];
    const [rows, total] = await Promise.all([
      this.db.hotelMovement.findMany({
        where,
        orderBy,
        skip: (params.page - 1) * params.limit,
        take: params.limit,
        include: {
          fromWarehouse: { select: WAREHOUSE_SELECT },
          warehouse: { select: WAREHOUSE_SELECT },
          receivedBy: { select: { id: true, name: true } },
          signoffBy: { select: { id: true, name: true } },
          lines: { select: { quantity: true, receivedQuantity: true } },
        },
      }),
      this.db.hotelMovement.count({ where }),
    ]);
    return {
      total,
      data: rows.map((m) => {
        const sent = m.lines.reduce((s, l) => s + Number(l.quantity), 0);
        const received = m.lines.reduce((s, l) => s + Number(l.receivedQuantity ?? 0), 0);
        return {
          id: m.id,
          folio: m.folio,
          from: m.fromWarehouse,
          to: m.warehouse,
          receivedBy: m.receivedBy,
          receivedAt: m.receivedAt,
          lines: m.lines.length,
          sentQuantity: sent,
          receivedQuantity: received,
          signoffStatus: m.signoffStatus,
          signoffBy: m.signoffBy,
          signoffAt: m.signoffAt,
          signoffNotes: m.signoffNotes,
        };
      }),
    };
  }
}
