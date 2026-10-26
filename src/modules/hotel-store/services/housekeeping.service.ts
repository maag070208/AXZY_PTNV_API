import { Prisma, type PrismaClient } from "@prisma/client";
import { prismaClient } from "@core/config/database";
import { HttpError } from "@core/middlewares/error.middleware";
import type { AuditLogger } from "@modules/users/services/user.service";
import type { HotelMovementService, MovementLineInput } from "./movement.service";
import { assertMovementShape } from "./kardex-rules";
import { assertKittable, assertWholeQuantity, resolveKitLines, type HotelCleaningType as KitCleaningType, type HotelKitFrequency } from "./hotel-catalog-rules";
import {
  assertAssignable,
  assertCancellable,
  assertInspectionReason,
  assertOperable,
  assertStartable,
  roomStatusAfterFinish,
  splitLinenLines,
  type HotelRoomStatus,
} from "./task-rules";

export type CleaningType = "CHECKOUT" | "STAY" | "TURNDOWN";

const KIT_CLEANING: Record<CleaningType, KitCleaningType> = { CHECKOUT: "CHECKOUT", STAY: "STAY", TURNDOWN: "TURNDOWN" };

const OPEN_TASK = ["PENDING", "IN_PROGRESS"] as const;
const MAX_ATTEMPTS = 3;

/** Callback the rooms service uses to open the task inside its own transaction. */
export type CleaningStartedHook = (
  tx: Prisma.TransactionClient,
  room: { id: string; typeId: string },
  cleaningType: CleaningType
) => Promise<void>;

/**
 * Housekeeping tasks (M5): created with the room change, assigned to a housekeeper
 * with a cart, started, finished (consumes the kit from the cart in one transaction),
 * and inspected when the zone or room type requires it.
 */
export class HotelHousekeepingService {
  constructor(
    private readonly db: PrismaClient = prismaClient,
    private readonly movements: HotelMovementService,
    private readonly inspectionRequired: (room: { typeId: string; zoneId: string }) => Promise<boolean>,
    private readonly audit?: AuditLogger
  ) {}

  /**
   * Opens the task for a room that starts cleaning. Runs inside the room's transaction.
   * A checkout whose type has no active kit still opens, with `kitAlert` set (P1):
   * the alert blocks finishing it until the kit is fixed.
   */
  async openForRoom(tx: Prisma.TransactionClient, room: { id: string; typeId: string; zoneId: string }, cleaningType: CleaningType) {
    const open = await tx.hotelHousekeepingTask.findFirst({
      where: { roomId: room.id, status: { in: [...OPEN_TASK] } },
      select: { id: true },
    });
    if (open) throw new HttpError(409, "HOTEL_TASK_OPEN_EXISTS");

    const type = await tx.hotelRoomType.findUnique({
      where: { id: room.typeId },
      select: { kitId: true, kit: { select: { id: true, active: true, lines: true } } },
    });
    const kitActive = !!type?.kit?.active;
    const requiresInspection = await this.inspectionRequired({ typeId: room.typeId, zoneId: room.zoneId });

    let lines: MovementLineInput[] = [];
    const kitAlert = cleaningType !== "TURNDOWN" && !kitActive;
    if (kitActive && type?.kit && cleaningType !== "TURNDOWN") {
      const lastAt = await this.lastFinishedByProduct(tx, room.id);
      const applicable = resolveKitLines(
        type.kit.lines.map((l) => ({
          productId: l.productId,
          quantity: Number(l.quantity),
          frequency: l.frequency as HotelKitFrequency,
          everyNDays: l.everyNDays,
        })),
        KIT_CLEANING[cleaningType],
        lastAt,
        new Date()
      );
      lines = applicable.map((l) => ({ productId: l.productId, quantity: l.quantity }));
    }

    return tx.hotelHousekeepingTask.create({
      data: {
        roomId: room.id,
        cleaningType,
        requiresInspection,
        kitId: kitActive ? type!.kit!.id : null,
        kitAlert,
        lines: {
          create: lines.map((l) => ({ productId: l.productId, quantity: l.quantity!, source: "KIT" })),
        },
      },
      include: { lines: true },
    });
  }

  /** Manual task from the housekeeping supervisor. A stay needs an active kit (409). */
  async createManual(input: { roomId: string; cleaningType: CleaningType }) {
    return this.serializable(async (tx) => {
      const room = await tx.hotelRoom.findUnique({
        where: { id: input.roomId },
        select: { id: true, typeId: true, zoneId: true, active: true },
      });
      if (!room || !room.active) throw new HttpError(404, "HOTEL_ROOM_NOT_FOUND");
      if (input.cleaningType === "STAY") {
        const type = await tx.hotelRoomType.findUnique({ where: { id: room.typeId }, select: { kit: { select: { active: true } } } });
        if (!type?.kit?.active) throw new HttpError(409, "HOTEL_KIT_NOT_AVAILABLE");
      }
      return this.openForRoom(tx, room, input.cleaningType);
    });
  }

  list(filters: { status?: string; assignedToId?: string; zoneIds?: string[] | null } = {}) {
    return this.db.hotelHousekeepingTask.findMany({
      where: {
        ...(filters.status ? { status: filters.status as never } : {}),
        ...(filters.assignedToId ? { assignedToId: filters.assignedToId } : {}),
        ...(filters.zoneIds ? { room: { zoneId: { in: filters.zoneIds } } } : {}),
      },
      include: { lines: true, room: { select: { id: true, number: true, zoneId: true } } },
      orderBy: { date: "desc" },
      take: 200,
    });
  }

  async get(id: string) {
    const task = await this.db.hotelHousekeepingTask.findUnique({
      where: { id },
      include: { lines: true, room: { select: { id: true, number: true, zoneId: true, status: true } }, inspection: true },
    });
    if (!task) throw new HttpError(404, "HOTEL_TASK_NOT_FOUND");
    return task;
  }

  /** The assignee needs an active cart of their own (M5 4.3). */
  async assign(id: string, assigneeId: string) {
    const task = await this.get(id);
    assertAssignable(task.status as never);
    const cart = await this.db.hotelWarehouse.findFirst({ where: { kind: "CART", ownerId: assigneeId, active: true }, select: { id: true } });
    if (!cart) throw new HttpError(409, "HOTEL_CART_REQUIRED");
    return this.db.hotelHousekeepingTask.update({ where: { id }, data: { assignedToId: assigneeId } });
  }

  /** Start: fixes the cart the consumption will come from. */
  async start(id: string) {
    const task = await this.get(id);
    assertStartable(task.status as never);
    if (!task.assignedToId) throw new HttpError(409, "HOTEL_TASK_UNASSIGNED");
    const cart = await this.db.hotelWarehouse.findFirst({ where: { kind: "CART", ownerId: task.assignedToId, active: true }, select: { id: true } });
    if (!cart) throw new HttpError(409, "HOTEL_CART_REQUIRED");
    return this.db.hotelHousekeepingTask.update({
      where: { id },
      data: { status: "IN_PROGRESS", startedAt: new Date(), cartWarehouseId: cart.id },
    });
  }

  /** Extra items (for example "two more towels"). Equipment cannot be added. */
  async addExtra(id: string, input: { productId: string; quantity: number }) {
    const task = await this.get(id);
    assertOperable(task.status as never);
    const product = await this.db.hotelProduct.findUnique({
      where: { id: input.productId },
      include: { unit: { select: { whole: true } } },
    });
    if (!product || !product.active) throw new HttpError(404, "HOTEL_PRODUCT_NOT_FOUND");
    assertKittable(product.kind as never);
    assertWholeQuantity(input.quantity, product.unit.whole);

    const existing = await this.db.hotelTaskLine.findUnique({
      where: { taskId_productId_source: { taskId: id, productId: input.productId, source: "EXTRA" } },
    });
    if (existing) {
      await this.db.hotelTaskLine.update({
        where: { id: existing.id },
        data: { quantity: Number(existing.quantity) + input.quantity },
      });
    } else {
      await this.db.hotelTaskLine.create({ data: { taskId: id, productId: input.productId, quantity: input.quantity, source: "EXTRA" } });
    }
    return this.get(id);
  }

  /**
   * Finishes the task in one transaction: consumes the kit lines from the cart, moves
   * the linen to the laundry, and updates the room. A repeated finish returns the
   * finished task without consuming again.
   */
  async finish(id: string, actorId: string, canManage: boolean) {
    return this.serializable(async (tx) => {
      const task = await tx.hotelHousekeepingTask.findUnique({
        where: { id },
        include: { lines: { include: { product: { select: { kind: true } } } }, room: { select: { id: true, status: true } } },
      });
      if (!task) throw new HttpError(404, "HOTEL_TASK_NOT_FOUND");
      if (task.status === "FINISHED") return task;
      if (task.status !== "IN_PROGRESS") throw new HttpError(409, "HOTEL_TASK_INVALID_STATE");
      if (!task.assignedToId) throw new HttpError(409, "HOTEL_TASK_UNASSIGNED");
      if (task.assignedToId !== actorId && !canManage) throw new HttpError(403, "INSUFFICIENT_PERMISSIONS");
      if (task.kitAlert && task.cleaningType === "CHECKOUT") throw new HttpError(409, "HOTEL_KIT_NOT_AVAILABLE");

      const cartId = task.cartWarehouseId!;
      const { consumed, linen } = splitLinenLines(
        task.lines.map((l) => ({ productId: l.productId, quantity: Number(l.quantity), kind: l.product.kind }))
      );

      let movementId: string | null = null;
      if (consumed.length > 0) {
        const input = {
          type: "ROOM_CONSUMPTION" as const,
          fromWarehouseId: cartId,
          roomId: task.roomId,
          lines: consumed.map((l) => ({ productId: l.productId, quantity: l.quantity })),
        };
        assertMovementShape(input.type, input);
        movementId = (await this.movements.applyInTransaction(tx, input, actorId, null)).id;
      }

      let linenMovementId: string | null = null;
      if (linen.length > 0) {
        const laundry = await tx.hotelWarehouse.findFirst({ where: { kind: "LAUNDRY", active: true }, select: { id: true } });
        if (!laundry) throw new HttpError(422, "HOTEL_LAUNDRY_NOT_CONFIGURED");
        const input = {
          type: "LINEN_EXCHANGE" as const,
          fromWarehouseId: cartId,
          warehouseId: laundry.id,
          roomId: task.roomId,
          lines: linen.map((l) => ({ productId: l.productId, quantity: l.quantity })),
        };
        assertMovementShape(input.type, input);
        linenMovementId = (await this.movements.applyInTransaction(tx, input, actorId, null)).id;
      }

      const next = roomStatusAfterFinish({
        roomStatus: task.room.status as HotelRoomStatus,
        cleaningType: task.cleaningType,
        isRework: task.isRework,
        requiresInspection: task.requiresInspection,
      });
      if (next) {
        await tx.hotelRoom.update({ where: { id: task.roomId }, data: { status: next } });
        await tx.hotelRoomStatusChange.create({
          data: { roomId: task.roomId, from: task.room.status, to: next, userId: actorId, notes: `Task ${task.id} finished` },
        });
      }

      const finished = await tx.hotelHousekeepingTask.update({
        where: { id },
        data: { status: "FINISHED", finishedAt: new Date(), movementId, linenMovementId },
        include: { lines: true },
      });
      void this.audit?.({
        action: "HOTEL_TASK_FINISHED",
        entityType: "HotelHousekeepingTask",
        entityId: id,
        userId: actorId,
        previousState: { status: "IN_PROGRESS" },
        newState: { status: "FINISHED", movementId, linenMovementId },
      });
      return finished;
    });
  }

  async cancel(id: string, actorId: string) {
    const task = await this.get(id);
    assertCancellable(task.status as never);
    void this.audit?.({
      action: "HOTEL_TASK_CANCELLED",
      entityType: "HotelHousekeepingTask",
      entityId: id,
      userId: actorId,
      previousState: { status: task.status },
      newState: { status: "CANCELLED" },
    });
    return this.db.hotelHousekeepingTask.update({ where: { id }, data: { status: "CANCELLED" } });
  }

  /**
   * Inspection of a finished task whose room waits in INSPECTION (M5 4.5). Approving
   * makes the room available. Rejecting needs a reason, sends the room back to
   * cleaning, and opens a rework task with no kit lines (extras only).
   */
  async inspect(id: string, input: { result: "APPROVED" | "REJECTED"; reasonId?: string | null; notes?: string | null }, actorId: string) {
    return this.serializable(async (tx) => {
      const task = await tx.hotelHousekeepingTask.findUnique({
        where: { id },
        include: { room: { select: { id: true, status: true } }, inspection: { select: { id: true } } },
      });
      if (!task) throw new HttpError(404, "HOTEL_TASK_NOT_FOUND");
      if (task.status !== "FINISHED" || task.room.status !== "INSPECTION") {
        throw new HttpError(409, "HOTEL_INSPECTION_NOT_PENDING");
      }
      if (task.inspection) throw new HttpError(409, "HOTEL_INSPECTION_EXISTS");
      assertInspectionReason(input.result, input.reasonId);

      const inspection = await tx.hotelInspection.create({
        data: {
          taskId: id,
          result: input.result,
          inspectorId: actorId,
          reasonId: input.reasonId ?? null,
          notes: input.notes ?? null,
        },
      });

      const nextRoom: HotelRoomStatus = input.result === "APPROVED" ? "AVAILABLE" : "CLEANING";
      await tx.hotelRoom.update({ where: { id: task.roomId }, data: { status: nextRoom } });
      await tx.hotelRoomStatusChange.create({
        data: {
          roomId: task.roomId,
          from: task.room.status,
          to: nextRoom,
          userId: actorId,
          reasonId: input.reasonId ?? null,
          notes: input.notes ?? null,
        },
      });

      let rework = null;
      if (input.result === "REJECTED") {
        rework = await tx.hotelHousekeepingTask.create({
          data: {
            roomId: task.roomId,
            cleaningType: "CHECKOUT",
            isRework: true,
            reworkOfId: id,
            requiresInspection: task.requiresInspection,
            kitAlert: false,
          },
        });
      }
      return { inspection, rework };
    });
  }

  private async lastFinishedByProduct(tx: Prisma.TransactionClient, roomId: string): Promise<Map<string, Date>> {
    const lines = await tx.hotelTaskLine.findMany({
      where: { task: { roomId, status: "FINISHED" } },
      select: { productId: true, task: { select: { finishedAt: true } } },
    });
    const last = new Map<string, Date>();
    for (const line of lines) {
      const at = line.task.finishedAt;
      if (!at) continue;
      const current = last.get(line.productId);
      if (!current || at > current) last.set(line.productId, at);
    }
    return last;
  }

  private serializable<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    const run = async (attempt: number): Promise<T> => {
      try {
        return await this.db.$transaction(fn, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      } catch (err) {
        if ((err as { code?: string })?.code === "P2034" && attempt < MAX_ATTEMPTS) return run(attempt + 1);
        throw err;
      }
    };
    return run(1);
  }
}
