import { Prisma, type PrismaClient } from "@prisma/client";
import { prismaClient } from "@core/config/database";
import { HttpError } from "@core/middlewares/error.middleware";
import type { AuditLogger } from "@modules/users/services/user.service";
import type { NotificationPort } from "@modules/notifications";
import type { HotelMovementService } from "../../services/movement.service";
import type { HotelGuestLossCreateInput, HotelGuestLossFromExtraInput, HotelGuestLossFromLoanInput } from "../models/dto/guest-loss.dto";
import { adjustmentUnitCost } from "./adjustment-report-rules";
import { locationIdsOf, runSerializable } from "./linen-locations";
import { createLinenWriteoffRequest } from "./writeoff-request";
import { GUEST_LOSS_REASON_CODE, WRITEOFF_DOC } from "./writeoff-rules";
import {
  assertExtraConvertible,
  assertLoanConvertible,
  assertNotConverted,
  normalizeGuestName,
  pickWriteoffToReclassify,
  resolveCharge,
  suggestedChargeAmount,
  unreturnedQty,
  type ChargeStatus,
} from "./guest-loss-rules";

type Notifier = Pick<NotificationPort, "createManyNotifications">;
const REVIEW_ROLES = ["HOTEL_OPS_MANAGER"];

/**
 * Pérdidas por huésped: baja WRITE_OFF con motivo G ligada a habitación y huésped. Reutiliza el
 * flujo de bajas (solicitud -> revisión Gerente Ops -> autorización Supervisora general): aquí solo
 * se crea o se reclasifica la baja; el cobro queda guardado pero sin flujo (integración futura).
 */
export class HotelGuestLossService {
  constructor(
    private readonly db: PrismaClient = prismaClient,
    private readonly movements: HotelMovementService,
    private readonly audit?: AuditLogger,
    private readonly notifications?: Notifier
  ) {}

  /** Registro directo (habitación + huésped + artículos). Devuelve el id de la baja creada. */
  async create(input: HotelGuestLossCreateInput, actorId: string) {
    const guestName = normalizeGuestName(input.guestName);
    const id = await runSerializable(async (tx) => {
      const room = await tx.hotelRoom.findUnique({ where: { id: input.roomId }, select: { id: true } });
      if (!room) throw new HttpError(404, "HOTEL_ROOM_NOT_FOUND");
      const movement = await createLinenWriteoffRequest(tx, {
        warehouseId: input.warehouseId,
        locationId: input.locationId ?? null,
        reasonCode: GUEST_LOSS_REASON_CODE,
        lines: input.lines.map((l) => ({ productId: l.productId, lotId: l.lotId ?? null, quantity: l.quantity })),
        notes: input.notes ?? null,
        actorId,
        roomId: room.id,
        guestName,
        movements: this.movements,
      });
      await this.applyCharge(tx, movement.id, input.chargeStatus, input.chargeAmount);
      return movement.id;
    }, this.db);
    await this.afterChange(id, actorId, "REGISTERED");
    return { id };
  }

  /** Almacén del préstamo (para validar alcance). */
  async loanWarehouse(folio: string): Promise<string> {
    const loan = await this.db.hotelTowelLoan.findUnique({ where: { folio }, select: { pointWarehouseId: true } });
    if (!loan) throw new HttpError(404, "HOTEL_LOAN_NOT_FOUND");
    return loan.pointWarehouseId;
  }

  /** Almacén de origen del adicional (para validar alcance). */
  async extraWarehouse(id: string): Promise<string> {
    const extra = await this.db.hotelRoomExtra.findUnique({ where: { id }, select: { sourceWarehouseId: true } });
    if (!extra) throw new HttpError(404, "HOTEL_EXTRA_NOT_FOUND");
    return extra.sourceWarehouseId;
  }

  /** Convierte un préstamo UNRETURNED en pérdida por huésped (sin recapturar huésped ni artículos). */
  async fromLoan(folio: string, input: HotelGuestLossFromLoanInput, actorId: string) {
    const id = await runSerializable(async (tx) => {
      const loan = await tx.hotelTowelLoan.findUnique({ where: { folio }, include: { guestLoss: { select: { status: true } } } });
      if (!loan) throw new HttpError(404, "HOTEL_LOAN_NOT_FOUND");
      const pending = unreturnedQty(Number(loan.quantity), Number(loan.returnedQty));
      assertLoanConvertible(loan.status, pending);
      assertNotConverted(loan.guestLoss?.status);
      const rooms = loan.room ? await tx.hotelRoom.findMany({ where: { number: loan.room.trim() }, select: { id: true }, take: 2 }) : [];
      const roomId = rooms.length === 1 ? rooms[0].id : null;
      const notes = [`Pérdida de huésped desde préstamo ${loan.folio}${loan.room && !roomId ? ` (hab. ${loan.room})` : ""}`, input.notes].filter(Boolean).join(". ");
      const lent = (await locationIdsOf(tx, loan.pointWarehouseId)).get("LENT");
      if (!lent) throw new HttpError(422, "HOTEL_LOCATION_NOT_IN_WAREHOUSE", { code: "LENT" });
      const movementId = await this.reclassifyOrCreate(tx, {
        // El corte de turno ya generó una baja F por préstamo (sourceDocId = corte, folio en notas).
        existing: loan.shiftCloseId ? { sourceDocId: loan.shiftCloseId, folio: loan.folio } : null,
        create: { warehouseId: loan.pointWarehouseId, locationId: lent, productId: loan.productId, quantity: pending, sourceDocId: loan.id },
        roomId,
        guestName: normalizeGuestName(loan.guestName),
        notes,
        charge: input,
        actorId,
      });
      await tx.hotelTowelLoan.update({ where: { id: loan.id }, data: { guestLossId: movementId } });
      return movementId;
    }, this.db);
    await this.afterChange(id, actorId, "FROM_LOAN");
    return { id };
  }

  /** Convierte un adicional MISSING en pérdida por huésped (el huésped se captura). */
  async fromExtra(extraId: string, input: HotelGuestLossFromExtraInput, actorId: string) {
    const id = await runSerializable(async (tx) => {
      const extra = await tx.hotelRoomExtra.findUnique({
        where: { id: extraId },
        include: { room: { select: { number: true } }, guestLoss: { select: { status: true } } },
      });
      if (!extra) throw new HttpError(404, "HOTEL_EXTRA_NOT_FOUND");
      assertExtraConvertible(extra.status, Number(extra.missingQty));
      assertNotConverted(extra.guestLoss?.status);
      const general = (await locationIdsOf(tx, extra.sourceWarehouseId)).get("GENERAL");
      if (!general) throw new HttpError(422, "HOTEL_LOCATION_NOT_IN_WAREHOUSE", { code: "GENERAL" });
      const movementId = await this.reclassifyOrCreate(tx, {
        // La recolección ya generó una baja F con sourceDocId = adicional.
        existing: { sourceDocId: extra.id },
        create: { warehouseId: extra.sourceWarehouseId, locationId: general, productId: extra.productId, quantity: Number(extra.missingQty), sourceDocId: extra.id },
        roomId: extra.roomId,
        guestName: normalizeGuestName(input.guestName),
        notes: [`Pérdida de huésped desde adicional no recolectado, hab. ${extra.room.number}`, input.notes].filter(Boolean).join(". "),
        charge: input,
        actorId,
      });
      await tx.hotelRoomExtra.update({ where: { id: extra.id }, data: { guestLossId: movementId } });
      return movementId;
    }, this.db);
    await this.afterChange(id, actorId, "FROM_EXTRA");
    return { id };
  }

  /**
   * Reclasifica a G la baja F que el sistema ya generó para el faltante (evita doble salida de stock);
   * si no existe una viva (rechazada o anterior al flujo), crea una baja G nueva desde la misma ubicación.
   */
  private async reclassifyOrCreate(
    tx: Prisma.TransactionClient,
    p: {
      existing: { sourceDocId: string; folio?: string } | null;
      create: { warehouseId: string; locationId: string; productId: string; quantity: number; sourceDocId: string };
      roomId: string | null;
      guestName: string;
      notes: string;
      charge: { chargeStatus?: ChargeStatus; chargeAmount?: number | null };
      actorId: string;
    }
  ): Promise<string> {
    const reason = await tx.hotelReason.findFirst({ where: { kind: "WRITE_OFF", code: GUEST_LOSS_REASON_CODE, active: true }, select: { id: true } });
    if (!reason) throw new HttpError(422, "HOTEL_WRITEOFF_REASON_MISSING");
    const candidates = p.existing
      ? await tx.hotelMovement.findMany({
          where: { type: "WRITE_OFF", sourceDocType: WRITEOFF_DOC, sourceDocId: p.existing.sourceDocId, reason: { code: "F" } },
          select: { id: true, status: true, guestName: true, notes: true },
          orderBy: { createdAt: "asc" },
        })
      : [];
    const found = pickWriteoffToReclassify(candidates, p.existing?.folio);
    let movementId: string;
    if (found) {
      movementId = found.id;
      await tx.hotelMovement.update({
        where: { id: movementId },
        data: { reasonId: reason.id, roomId: p.roomId, guestName: p.guestName, notes: [found.notes, p.notes].filter(Boolean).join(" | ") },
      });
    } else {
      const created = await createLinenWriteoffRequest(tx, {
        warehouseId: p.create.warehouseId,
        locationId: p.create.locationId,
        reasonCode: GUEST_LOSS_REASON_CODE,
        lines: [{ productId: p.create.productId, quantity: p.create.quantity, locationId: p.create.locationId }],
        notes: p.notes,
        actorId: p.actorId,
        sourceDocId: p.create.sourceDocId,
        roomId: p.roomId,
        guestName: p.guestName,
        movements: this.movements,
      });
      movementId = created.id;
    }
    await this.applyCharge(tx, movementId, p.charge.chargeStatus, p.charge.chargeAmount);
    return movementId;
  }

  /** Cobro: sugerido = costo unitario × piezas (con último costo del producto si la línea no trae). */
  private async applyCharge(tx: Prisma.TransactionClient, movementId: string, status: ChargeStatus | undefined, amount: number | null | undefined) {
    const lines = await tx.hotelMovementLine.findMany({ where: { movementId }, select: { quantity: true, unitCost: true, product: { select: { lastCost: true } } } });
    const suggested = suggestedChargeAmount(
      lines.map((l) => ({
        quantity: Number(l.quantity),
        unitCost: adjustmentUnitCost(l.unitCost === null ? null : Number(l.unitCost), l.product.lastCost === null ? null : Number(l.product.lastCost)),
      }))
    );
    const charge = resolveCharge(status, amount, suggested);
    await tx.hotelMovement.update({ where: { id: movementId }, data: charge });
  }

  private async afterChange(id: string, actorId: string, origin: string) {
    const m = await this.db.hotelMovement.findUnique({ where: { id }, select: { folio: true, status: true, guestName: true } });
    await this.audit?.({
      action: "HOTEL_LINEN_GUEST_LOSS",
      entityType: "HotelMovement",
      entityId: id,
      userId: actorId,
      newState: { folio: m?.folio, status: m?.status, guestName: m?.guestName, origin },
    });
    if (m?.status !== "PENDING_APPROVAL" || !this.notifications) return;
    try {
      const users = await this.db.user.findMany({
        where: { active: true, OR: [{ role: { in: REVIEW_ROLES } }, { extraRoles: { some: { role: { in: REVIEW_ROLES } } } }] },
        select: { id: true },
      });
      if (users.length === 0) return;
      await this.notifications.createManyNotifications(
        users.map((u) => ({ userId: u.id, type: "HOTEL_LINEN_WRITEOFF", title: `Pérdida de huésped por revisar (${m.folio})`, detail: "Pendiente de revisión" }))
      );
    } catch {
      // El aviso es secundario: un fallo de notificación no revierte el registro.
    }
  }
}
