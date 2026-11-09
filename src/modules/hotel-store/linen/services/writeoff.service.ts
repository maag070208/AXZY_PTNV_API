import crypto from "crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import { prismaClient } from "@core/config/database";
import { HttpError } from "@core/middlewares/error.middleware";
import { downloadObject, uploadObject } from "@core/services/storage";
import { env } from "@core/config/env.config";
import type { AuditLogger } from "@modules/users/services/user.service";
import type { NotificationPort } from "@modules/notifications";
import { filterDateRange, filterEnum, filterId, filterText, orderByOf, type ITDataTableFetchParams } from "@core/utils/table";
import type { HotelMovementService } from "../../services/movement.service";
import type { HotelSignatureService } from "./signature.service";
import { dayRange } from "./day-range";
import { runSerializable } from "./linen-locations";
import { createLinenWriteoffRequest } from "./writeoff-request";
import type { HotelWriteoffCreateInput } from "../models/dto/writeoff.dto";
import { assertMovementShape } from "../../services/kardex-rules";
import {
  QUARANTINE_LOCATION_CODE,
  WRITEOFF_DOC,
  imageMimeOf,
  WRITEOFF_HOLD_DOC,
  WRITEOFF_RELEASE_DOC,
  assertNotRequester,
  assertPhotos,
  assertReviewedOrOverride,
  buildWeeklyMatrix,
  groupByReason,
  type Disposition,
  type ReasonCode,
} from "./writeoff-rules";

type Notifier = Pick<NotificationPort, "createManyNotifications">;

const TABLE_STATUSES = ["PENDING_APPROVAL", "ACTIVE", "CANCELLED"] as const;
const STAGES = ["review", "authorize"] as const;
const WAREHOUSE_SELECT = { id: true, code: true, name: true, kind: true } as const;
const USER_SELECT = { id: true, name: true } as const;
const MAX_PHOTOS = 10;
/** Tope por foto (el formulario comprime a 1280 px JPEG antes de subir). */
const MAX_PHOTO_BYTES = 2.5 * 1024 * 1024;
const BASE_WHERE = { type: "WRITE_OFF", sourceDocType: WRITEOFF_DOC } as const;

/** Roles a los que se avisa en cada etapa (Gerente Ops revisa, Supervisora general autoriza). */
const REVIEW_ROLES = ["HOTEL_OPS_MANAGER"];
const AUTHORIZE_ROLES = ["HOTEL_GENERAL_SUPERVISOR"];

export interface UploadedPhoto {
  buffer: Buffer;
  mimetype: string;
  size: number;
  originalname: string;
}

/**
 * Bajas de blancos (D9): solicitud con fotos -> revisión (Gerente Ops) -> autorización (Supervisora
 * general, distinta de quien solicita) -> sale el stock. Cada baja es un movimiento WRITE_OFF
 * (documento HOTEL_WRITEOFF) con un solo motivo.
 */
export class HotelWriteoffService {
  constructor(
    private readonly db: PrismaClient = prismaClient,
    private readonly movements: HotelMovementService,
    private readonly signatures: HotelSignatureService,
    private readonly audit?: AuditLogger,
    private readonly notifications?: Notifier
  ) {}

  /** Crea una baja pendiente por cada motivo de la solicitud y les adjunta las fotos. */
  async create(input: HotelWriteoffCreateInput, photos: UploadedPhoto[], actorId: string) {
    const groups = groupByReason(input.lines);
    assertPhotos([...groups.keys()], photos.length);
    if (photos.length > MAX_PHOTOS) throw new HttpError(422, "HOTEL_WRITEOFF_LINES_INVALID");
    for (const p of photos) {
      if (p.size > Math.min(env.UPLOAD_MAX_BYTES, MAX_PHOTO_BYTES)) throw new HttpError(400, "FILE_TOO_LARGE");
      if (!imageMimeOf(p.buffer)) throw new HttpError(400, "FILE_TYPE_NOT_ALLOWED");
    }

    const stored = await Promise.all(
      photos.map(async (p) => {
        const mime = imageMimeOf(p.buffer)!;
        const key = `hotel-writeoffs/${crypto.randomUUID()}-${p.originalname.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
        await uploadObject(key, p.buffer, mime);
        // La evidencia es privada: solo se sirve con sesión por el endpoint (no se guarda URL pública).
        return { fileKey: key, url: null, mime, size: p.size };
      })
    );

    const created = await runSerializable(async (tx) => {
      const out: Array<{ id: string; folio: string; reasonCode: ReasonCode }> = [];
      for (const [reasonCode, lines] of groups) {
        const movement = await createLinenWriteoffRequest(tx, {
          warehouseId: input.warehouseId,
          locationId: input.locationId,
          reasonCode,
          lines,
          notes: input.notes,
          actorId,
          movements: this.movements,
        });
        if (stored.length > 0) {
          await tx.hotelWriteoffEvidence.createMany({
            data: stored.map((s) => ({ movementId: movement.id, uploadedById: actorId, ...s })),
          });
        }
        out.push({ id: movement.id, folio: movement.folio, reasonCode });
      }
      return out;
    }, this.db);

    for (const w of created) {
      await this.log("HOTEL_LINEN_WRITEOFF_REQUESTED", w.id, actorId, {}, { folio: w.folio, reason: w.reasonCode, photos: stored.length });
    }
    await this.notify(REVIEW_ROLES, "HOTEL_LINEN_WRITEOFF", `Baja de blancos por revisar (${created.map((w) => w.folio).join(", ")})`, "Pendiente de revisión");
    return Promise.all(created.map((w) => this.get(w.id)));
  }

  /** Revisión del Gerente Ops (firma REVIEWS). */
  async review(id: string, actorId: string, reviewerId: string, method: "SESSION" | "PASSWORD", notes?: string | null) {
    const folio = await runSerializable(async (tx) => {
      const movement = await this.findPending(tx, id);
      const already = await tx.hotelSignature.findFirst({ where: { docType: WRITEOFF_DOC, docId: id, role: "REVIEWS" }, select: { id: true } });
      if (already) throw new HttpError(409, "HOTEL_WRITEOFF_ALREADY_REVIEWED");
      await this.signatures.sign(WRITEOFF_DOC, id, "REVIEWS", reviewerId, method, tx, notes);
      return movement.folio;
    }, this.db);
    await this.log("HOTEL_LINEN_WRITEOFF_REVIEWED", id, actorId, { status: "PENDING_APPROVAL" }, { folio, reviewedBy: reviewerId });
    await this.notify(AUTHORIZE_ROLES, "HOTEL_LINEN_WRITEOFF", `Baja de blancos por autorizar (${folio})`, "Revisada, pendiente de autorización");
    return this.get(id);
  }

  /**
   * Autoriza: sale el stock de los lotes reservados y se registra el destino. Quien solicitó no
   * autoriza nunca; sin revisión solo pasa con `canSkipReview` (alcance TODO) y queda marcada.
   */
  async approve(id: string, actorId: string, authorizerId: string, method: "SESSION" | "PASSWORD", disposition: Disposition, canSkipReview: boolean, notes?: string | null) {
    const result = await runSerializable(async (tx) => {
      const movement = await this.findPending(tx, id, true);
      assertNotRequester(movement.createdById, authorizerId);
      const reviewed = Boolean(await tx.hotelSignature.findFirst({ where: { docType: WRITEOFF_DOC, docId: id, role: "REVIEWS" }, select: { id: true } }));
      const { reviewSkipped } = assertReviewedOrOverride(reviewed, canSkipReview);
      for (const line of movement.lines) {
        await this.movements.move(tx, line.productId, movement.fromWarehouseId!, line.fromLocationId!, line.lotId, -Number(line.quantity));
      }
      await tx.hotelMovement.update({
        where: { id },
        data: { status: "ACTIVE", approvedById: authorizerId, approvedAt: new Date(), disposition },
      });
      await this.signatures.sign(WRITEOFF_DOC, id, "AUTHORIZES", authorizerId, method, tx, notes);
      return { folio: movement.folio, reviewSkipped };
    }, this.db);
    await this.log("HOTEL_LINEN_WRITEOFF_APPROVED", id, actorId, { status: "PENDING_APPROVAL" }, { status: "ACTIVE", folio: result.folio, disposition, reviewSkipped: result.reviewSkipped });
    return this.get(id);
  }

  /**
   * Rechaza: la baja se cancela y, si la pieza estaba retenida en cuarentena, regresa a su área
   * con un traspaso interno de liberación (ajuste demo v2).
   */
  async reject(id: string, actorId: string, authorizerId: string, method: "SESSION" | "PASSWORD", notes: string) {
    const folio = await runSerializable(async (tx) => {
      const movement = await this.findPending(tx, id);
      assertNotRequester(movement.createdById, authorizerId);
      const hold = await tx.hotelMovement.findFirst({
        where: { sourceDocType: WRITEOFF_HOLD_DOC, sourceDocId: id },
        include: { lines: true },
      });
      if (hold?.fromWarehouseId && hold.warehouseId) {
        const releaseInput = {
          type: "TRANSFER" as const,
          fromWarehouseId: hold.warehouseId,
          warehouseId: hold.fromWarehouseId,
          sourceDocType: WRITEOFF_RELEASE_DOC,
          sourceDocId: id,
          notes: `Regreso de cuarentena (baja rechazada)`,
          lines: hold.lines.map((l) => ({
            productId: l.productId,
            quantity: Number(l.quantity),
            lotId: l.lotId,
            fromLocationId: l.toLocationId ?? undefined,
            toLocationId: l.fromLocationId ?? undefined,
          })),
        };
        assertMovementShape("TRANSFER", releaseInput);
        await this.movements.applyInTransaction(tx, releaseInput, authorizerId, null);
      }
      await tx.hotelMovement.update({ where: { id }, data: { status: "CANCELLED", approvedById: authorizerId, approvedAt: new Date() } });
      await this.signatures.sign(WRITEOFF_DOC, id, "AUTHORIZES", authorizerId, method, tx, `REJECTED: ${notes}`);
      return movement.folio;
    }, this.db);
    await this.log("HOTEL_LINEN_WRITEOFF_REJECTED", id, actorId, { status: "PENDING_APPROVAL" }, { status: "CANCELLED", folio, notes, releasedFromQuarantine: true });
    return this.get(id);
  }

  /** Tabla server-side. Filtros: status, stage (review | authorize), warehouseId, reason, folio, date. */
  async table(params: ITDataTableFetchParams, visibleIds: string[] | null) {
    const f = params.filters;
    const status = filterEnum(f, "status", TABLE_STATUSES);
    const stage = filterEnum(f, "stage", STAGES);
    const warehouseId = filterId(f, "warehouseId");
    const reason = filterId(f, "reason");
    let stageWhere: Prisma.HotelMovementWhereInput = {};
    if (stage) {
      const reviewed = (await this.db.hotelSignature.findMany({ where: { docType: WRITEOFF_DOC, role: "REVIEWS" }, select: { docId: true } })).map((s) => s.docId);
      stageWhere = { status: "PENDING_APPROVAL", id: stage === "review" ? { notIn: reviewed } : { in: reviewed } };
    }
    const where: Prisma.HotelMovementWhereInput = {
      ...BASE_WHERE,
      ...(status ? { status } : {}),
      ...(reason ? { reason: { code: reason } } : {}),
      ...(filterDateRange(f, "date") ? { date: filterDateRange(f, "date") } : {}),
      ...(filterText(f, "folio") ? { folio: filterText(f, "folio") } : {}),
      AND: [
        stageWhere,
        ...(warehouseId ? [{ OR: [{ originWarehouseId: warehouseId }, { fromWarehouseId: warehouseId }] }] : []),
        ...(visibleIds ? [{ OR: [{ originWarehouseId: { in: visibleIds } }, { fromWarehouseId: { in: visibleIds } }] }] : []),
      ],
    };
    const orderBy = orderByOf(params.sort, { folio: "folio", date: "date", status: "status" }, [{ date: "desc" }]) as Prisma.HotelMovementOrderByWithRelationInput[];
    const [rows, total] = await Promise.all([
      this.db.hotelMovement.findMany({
        where,
        orderBy,
        skip: (params.page - 1) * params.limit,
        take: params.limit,
        include: {
          fromWarehouse: { select: WAREHOUSE_SELECT },
          originWarehouse: { select: WAREHOUSE_SELECT },
          reason: { select: { code: true, name: true } },
          createdBy: { select: USER_SELECT },
          lines: { select: { quantity: true, unitCost: true, fromLocation: { select: { code: true } } } },
          _count: { select: { writeoffEvidence: true } },
        },
      }),
      this.db.hotelMovement.count({ where }),
    ]);
    const reviewedIds = new Set(
      (await this.db.hotelSignature.findMany({ where: { docType: WRITEOFF_DOC, role: "REVIEWS", docId: { in: rows.map((r) => r.id) } }, select: { docId: true } })).map((s) => s.docId)
    );
    return {
      total,
      data: rows.map((m) => ({
        id: m.id,
        folio: m.folio,
        date: m.date,
        status: m.status,
        warehouse: m.originWarehouse ?? m.fromWarehouse,
        originWarehouse: m.originWarehouse ?? m.fromWarehouse,
        quarantined: m.status === "PENDING_APPROVAL" && m.lines.some((l) => l.fromLocation?.code === QUARANTINE_LOCATION_CODE),
        reason: m.reason,
        requestedBy: m.createdBy,
        reviewed: reviewedIds.has(m.id),
        disposition: m.disposition,
        lines: m.lines.length,
        quantity: m.lines.reduce((s, l) => s + Number(l.quantity), 0),
        cost: m.lines.reduce((s, l) => s + Number(l.quantity) * Number(l.unitCost ?? 0), 0),
        photos: m._count.writeoffEvidence,
      })),
    };
  }

  /** Detalle: líneas con lote, fotos, firmas y marca de "sin revisión". */
  async get(id: string) {
    const m = await this.db.hotelMovement.findFirst({
      where: { id, ...BASE_WHERE },
      include: {
        fromWarehouse: { select: WAREHOUSE_SELECT },
        originWarehouse: { select: WAREHOUSE_SELECT },
        reason: { select: { code: true, name: true } },
        createdBy: { select: USER_SELECT },
        approvedBy: { select: USER_SELECT },
        writeoffEvidence: { orderBy: { createdAt: "asc" } },
        lines: {
          include: {
            product: { select: { id: true, code: true, name: true, size: true } },
            lot: { select: { id: true, code: true } },
            fromLocation: { select: { id: true, code: true } },
          },
        },
      },
    });
    if (!m) throw new HttpError(404, "HOTEL_WRITEOFF_NOT_FOUND");
    const signatures = await this.signatures.list(WRITEOFF_DOC, id);
    const lines = m.lines.map((l) => ({
      id: l.id,
      product: l.product,
      lot: l.lot,
      location: l.fromLocation,
      quantity: Number(l.quantity),
      unitCost: l.unitCost === null ? null : Number(l.unitCost),
    }));
    return {
      id: m.id,
      folio: m.folio,
      date: m.date,
      status: m.status,
      warehouse: m.originWarehouse ?? m.fromWarehouse,
      warehouseId: m.originWarehouseId ?? m.fromWarehouseId,
      originWarehouse: m.originWarehouse ?? m.fromWarehouse,
      quarantined: m.status === "PENDING_APPROVAL" && lines.some((l) => l.location?.code === QUARANTINE_LOCATION_CODE),
      reason: m.reason,
      notes: m.notes,
      requestedBy: m.createdBy,
      approvedBy: m.approvedBy,
      approvedAt: m.approvedAt,
      disposition: m.disposition,
      stocktakeId: m.stocktakeId,
      lines,
      cost: lines.reduce((s, l) => s + l.quantity * (l.unitCost ?? 0), 0),
      evidence: m.writeoffEvidence.map((e) => ({ id: e.id, mime: e.mime, size: e.size, url: null, createdAt: e.createdAt })),
      signatures: signatures.map((s) => ({ role: s.role, method: s.method, signedAt: s.signedAt, notes: s.notes, user: s.user })),
      reviewed: signatures.some((s) => s.role === "REVIEWS"),
      // Autorizada sin que el Gerente Ops la revisara.
      reviewSkipped: m.status === "ACTIVE" && !signatures.some((s) => s.role === "REVIEWS"),
    };
  }

  /** Archivo de una foto (para el stream del endpoint). */
  async evidenceFile(id: string, evidenceId: string) {
    const evidence = await this.db.hotelWriteoffEvidence.findFirst({ where: { id: evidenceId, movementId: id }, select: { fileKey: true, mime: true } });
    if (!evidence) throw new HttpError(404, "HOTEL_WRITEOFF_EVIDENCE_NOT_FOUND");
    return { mime: evidence.mime, body: await downloadObject(evidence.fileKey) };
  }

  /** Almacén de una baja (para validar alcance). */
  async warehouseOf(id: string): Promise<string | null> {
    const m = await this.db.hotelMovement.findFirst({
      where: { id, ...BASE_WHERE },
      select: { fromWarehouseId: true, originWarehouseId: true },
    });
    if (!m) throw new HttpError(404, "HOTEL_WRITEOFF_NOT_FOUND");
    return m.originWarehouseId ?? m.fromWarehouseId;
  }

  /** Reporte semanal (formato pág. 15): solo bajas autorizadas en el rango, producto × motivo, con costo. */
  async weekly(from: string | undefined, to: string | undefined, visibleIds: string[] | null) {
    const start = dayRange(from).from;
    const end = dayRange(to ?? from).to;
    const movements = await this.db.hotelMovement.findMany({
      where: {
        ...BASE_WHERE,
        status: "ACTIVE",
        approvedAt: { gte: start, lt: end },
        ...(visibleIds ? { OR: [{ originWarehouseId: { in: visibleIds } }, { fromWarehouseId: { in: visibleIds } }] } : {}),
      },
      include: {
        reason: { select: { code: true } },
        lines: { include: { product: { select: { id: true, code: true, name: true, size: true } } } },
      },
    });
    const matrix = buildWeeklyMatrix(
      movements.flatMap((m) =>
        m.lines.map((l) => ({
          productId: l.productId,
          code: l.product.code,
          name: l.product.name,
          size: l.product.size,
          reasonCode: m.reason?.code ?? null,
          quantity: Number(l.quantity),
          unitCost: Number(l.unitCost ?? 0),
        }))
      )
    );
    return { from: start, to: new Date(end.getTime() - 1), writeoffs: movements.length, ...matrix };
  }

  /** Estado físico A–E por producto: del último conteo aplicado de cada almacén. */
  async condition(warehouseId?: string, visibleIds?: string[] | null) {
    const warehouses = await this.db.hotelStocktake.findMany({
      where: { status: "APPLIED", ...(warehouseId ? { warehouseId } : {}), ...(visibleIds ? { warehouseId: { in: visibleIds } } : {}) },
      distinct: ["warehouseId"],
      orderBy: [{ warehouseId: "asc" }, { approvedAt: "desc" }],
      select: { id: true, folio: true, approvedAt: true, warehouse: { select: WAREHOUSE_SELECT } },
    });
    const lines = await this.db.hotelStocktakeLine.findMany({
      where: { stocktakeId: { in: warehouses.map((w) => w.id) }, gradeA: { not: null } },
      include: { product: { select: { id: true, code: true, name: true, size: true } } },
    });
    const num = (v: Prisma.Decimal | null) => Number(v ?? 0);
    const grade = (acc: Map<string, ConditionRow>, l: (typeof lines)[number]) => {
      const row = acc.get(l.productId) ?? { product: l.product, A: 0, B: 0, C: 0, D: 0, E: 0, total: 0 };
      row.A += num(l.gradeA); row.B += num(l.gradeB); row.C += num(l.gradeC); row.D += num(l.gradeD); row.E += num(l.gradeE);
      row.total = row.A + row.B + row.C + row.D + row.E;
      acc.set(l.productId, row);
    };
    const all = new Map<string, ConditionRow>();
    lines.forEach((l) => grade(all, l));
    return {
      warehouses: warehouses.map((w) => {
        const acc = new Map<string, ConditionRow>();
        lines.filter((l) => l.stocktakeId === w.id).forEach((l) => grade(acc, l));
        return { warehouse: w.warehouse, stocktake: { id: w.id, folio: w.folio, approvedAt: w.approvedAt }, products: [...acc.values()] };
      }),
      products: [...all.values()],
    };
  }

  private async findPending(tx: Prisma.TransactionClient, id: string, withLines = false) {
    const m = await tx.hotelMovement.findFirst({ where: { id, ...BASE_WHERE }, include: { lines: withLines } });
    if (!m) throw new HttpError(404, "HOTEL_WRITEOFF_NOT_FOUND");
    if (m.status !== "PENDING_APPROVAL") throw new HttpError(409, "HOTEL_WRITEOFF_INVALID_STATE");
    return m as typeof m & { lines: Array<{ productId: string; lotId: string; fromLocationId: string | null; quantity: Prisma.Decimal }> };
  }

  private async notify(roles: string[], type: string, title: string, detail: string) {
    if (!this.notifications) return;
    try {
      const users = await this.db.user.findMany({
        where: { active: true, OR: [{ role: { in: roles } }, { extraRoles: { some: { role: { in: roles } } } }] },
        select: { id: true },
      });
      if (users.length === 0) return;
      await this.notifications.createManyNotifications(users.map((u) => ({ userId: u.id, type, title, detail })));
    } catch {
      // El aviso es secundario: un fallo de notificación no revierte la baja.
    }
  }

  private async log(action: string, id: string, actorId: string, previousState: object, newState: object) {
    await this.audit?.({ action, entityType: "HotelMovement", entityId: id, userId: actorId, previousState, newState });
  }
}

interface ConditionRow {
  product: { id: string; code: string; name: string; size: string | null };
  A: number; B: number; C: number; D: number; E: number; total: number;
}
