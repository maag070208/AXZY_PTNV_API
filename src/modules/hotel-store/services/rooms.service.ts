import type { Prisma, PrismaClient } from "@prisma/client";
import { prismaClient } from "@core/config/database";
import { HttpError } from "@core/middlewares/error.middleware";
import { scopeOf, type PermissionScope } from "@core/permissions";
import type { AuditLogger } from "@modules/users/services/user.service";
import type {
  HotelRoomStatusInput,
  HotelRoomTypeUpdateInput,
  HotelZoneUpdateInput,
} from "../models/dto/rooms.dto";

/** Quien ejecuta: lo que necesita el resolvedor de alcances. */
export interface Caller {
  id: string;
  role: string;
  roles?: string[];
  departmentId?: string | null;
  exceptions?: Array<{ permission: string; scope: PermissionScope; expiresAt: Date | null }>;
}

export class HotelRoomsService {
  constructor(
    private readonly db: PrismaClient = prismaClient,
    private readonly audit?: AuditLogger
  ) {}

  // ── Alcance por zona ───────────────────────────────────────────────────────

  /**
   * Ids de zona visibles para el usuario. `null` = todas (alcance ALL).
   * AREA = zonas asignadas más todos sus descendientes; OWN = nada (para
   * habitaciones el alcance propio no aplica).
   */
  async visibleZoneIds(caller: Caller, permission: string): Promise<Set<string> | null> {
    const scope = scopeOf(caller as never, permission);
    if (scope === "ALL") return null;
    if (scope !== "AREA") return new Set();

    const [assigned, zones] = await Promise.all([
      this.db.hotelZoneSupervisor.findMany({ where: { userId: caller.id }, select: { zoneId: true } }),
      this.db.hotelZone.findMany({ select: { id: true, parentId: true, kind: true } }),
    ]);
    const byParent = new Map<string, string[]>();
    for (const zone of zones) {
      const key = zone.parentId ?? "__root__";
      const list = byParent.get(key) ?? [];
      list.push(zone.id);
      byParent.set(key, list);
    }
    const visible = new Set<string>();
    const walk = (id: string) => {
      if (visible.has(id)) return;
      visible.add(id);
      for (const child of byParent.get(id) ?? []) walk(child);
    };
    for (const zone of assigned) walk(zone.zoneId);
    return visible;
  }

  private async assertInScope(caller: Caller, zoneId: string, permission: string): Promise<void> {
    const visible = await this.visibleZoneIds(caller, permission);
    if (visible && !visible.has(zoneId)) throw new HttpError(403, "HOTEL_ACCESS_DENIED");
  }

  /** Inspección efectiva: el tipo o cualquier ancestro de la zona de la habitación. */
  async inspectionRequired(room: { typeId: string; zoneId: string }): Promise<boolean> {
    const [type, zones] = await Promise.all([
      this.db.hotelRoomType.findUnique({ where: { id: room.typeId }, select: { requiresInspection: true } }),
      this.db.hotelZone.findMany({ select: { id: true, parentId: true, requiresInspection: true } }),
    ]);
    if (type?.requiresInspection) return true;
    const byId = new Map(zones.map((z) => [z.id, z]));
    let current = byId.get(room.zoneId);
    while (current) {
      if (current.requiresInspection) return true;
      current = current.parentId ? byId.get(current.parentId) : undefined;
    }
    return false;
  }

  // ── Zonas ──────────────────────────────────────────────────────────────────

  async zones(caller: Caller, includeInactive = false) {
    const visible = await this.visibleZoneIds(caller, "hotel_rooms.view");
    const zones = await this.db.hotelZone.findMany({
      where: {
        ...(includeInactive ? {} : { active: true }),
        ...(visible ? { id: { in: [...visible] } } : {}),
      },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      include: {
        parent: { select: { id: true, name: true, kind: true } },
        _count: { select: { rooms: true, children: true } },
      },
    });
    return zones;
  }

  private async assertZoneParent(
    kind: "EDIFICIO" | "PISO" | "AREA",
    parentId: string | null | undefined
  ): Promise<void> {
    if (kind === "PISO") {
      if (!parentId) throw new HttpError(409, "HOTEL_ZONE_PARENT_INVALID");
      const parent = await this.db.hotelZone.findUnique({ where: { id: parentId } });
      if (!parent || parent.kind !== "EDIFICIO" || !parent.active) {
        throw new HttpError(409, "HOTEL_ZONE_PARENT_INVALID");
      }
      return;
    }
    if (parentId) throw new HttpError(409, "HOTEL_ZONE_PARENT_INVALID");
  }

  async createZone(input: {
    name: string;
    kind: "EDIFICIO" | "PISO" | "AREA";
    parentId?: string | null;
    description?: string | null;
    requiresInspection?: boolean;
    sortOrder?: number;
  }) {
    await this.assertZoneParent(input.kind, input.parentId);
    return this.db.hotelZone.create({
      data: {
        name: input.name,
        kind: input.kind,
        parentId: input.parentId ?? null,
        description: input.description ?? null,
        requiresInspection: input.requiresInspection ?? false,
        sortOrder: input.sortOrder ?? 0,
      },
    });
  }

  async updateZone(caller: Caller, id: string, input: HotelZoneUpdateInput) {
    const zone = await this.db.hotelZone.findUnique({ where: { id } });
    if (!zone) throw new HttpError(404, "HOTEL_ZONE_NOT_FOUND");

    if (input.kind !== undefined || input.parentId !== undefined) {
      const kind = (input.kind ?? zone.kind) as "EDIFICIO" | "PISO" | "AREA";
      const parentId = input.parentId !== undefined ? input.parentId : zone.parentId;
      if (id === parentId) throw new HttpError(409, "HOTEL_ZONE_PARENT_INVALID");
      await this.assertZoneParent(kind, parentId);
    }
    if (input.active === false) {
      const [rooms, children] = await Promise.all([
        this.db.hotelRoom.count({ where: { zoneId: id, active: true } }),
        this.db.hotelZone.count({ where: { parentId: id, active: true } }),
      ]);
      if (rooms > 0 || children > 0) throw new HttpError(409, "HOTEL_ZONE_IN_USE");
    }
    const updated = await this.db.hotelZone.update({
      where: { id },
      data: {
        name: input.name,
        kind: input.kind,
        parentId: input.parentId === undefined ? undefined : input.parentId,
        description: input.description,
        requiresInspection: input.requiresInspection,
        sortOrder: input.sortOrder,
        active: input.active,
      },
    });
    await this.audit?.({
      action: "HOTEL_ZONE_UPDATED",
      entityType: "HotelZone",
      entityId: id,
      userId: caller.id,
      metadata: { after: updated },
    });
    return updated;
  }

  /** Borrado lógico: no se borra una zona con habitaciones o hijos activos. */
  async removeZone(caller: Caller, id: string) {
    const zone = await this.db.hotelZone.findUnique({ where: { id } });
    if (!zone) throw new HttpError(404, "HOTEL_ZONE_NOT_FOUND");
    const [rooms, children] = await Promise.all([
      this.db.hotelRoom.count({ where: { zoneId: id, active: true } }),
      this.db.hotelZone.count({ where: { parentId: id, active: true } }),
    ]);
    if (rooms > 0 || children > 0) throw new HttpError(409, "HOTEL_ZONE_IN_USE");
    const updated = await this.db.hotelZone.update({ where: { id }, data: { active: false } });
    await this.audit?.({
      action: "HOTEL_ZONE_DISABLED",
      entityType: "HotelZone",
      entityId: id,
      userId: caller.id,
    });
    return updated;
  }

  async setZoneSupervisors(caller: Caller, zoneId: string, userIds: string[]) {
    const zone = await this.db.hotelZone.findUnique({ where: { id: zoneId } });
    if (!zone) throw new HttpError(404, "HOTEL_ZONE_NOT_FOUND");
    await this.db.$transaction([
      this.db.hotelZoneSupervisor.deleteMany({ where: { zoneId } }),
      this.db.hotelZoneSupervisor.createMany({
        data: userIds.map((userId) => ({ zoneId, userId })),
      }),
    ]);
    await this.audit?.({
      action: "HOTEL_ZONE_SUPERVISORS_UPDATED",
      entityType: "HotelZone",
      entityId: zoneId,
      userId: caller.id,
      metadata: { userIds },
    });
    return this.db.hotelZoneSupervisor.findMany({ where: { zoneId } });
  }

  // ── Tipos de habitación ────────────────────────────────────────────────────

  async roomTypes(includeInactive = false) {
    return this.db.hotelRoomType.findMany({
      where: includeInactive ? {} : { active: true },
      orderBy: { name: "asc" },
      include: {
        kit: { select: { id: true, name: true, active: true } },
        _count: { select: { rooms: true } },
      },
    });
  }

  private async assertKitForType(kitId: string | null | undefined, active: boolean): Promise<void> {
    if (!active) return;
    if (!kitId) throw new HttpError(409, "HOTEL_KIT_NOT_AVAILABLE");
    const kit = await this.db.hotelKit.findUnique({ where: { id: kitId }, select: { active: true } });
    if (!kit || !kit.active) throw new HttpError(409, "HOTEL_KIT_NOT_AVAILABLE");
  }

  async createRoomType(input: {
    name: string;
    beds?: number;
    capacity?: number;
    description?: string | null;
    requiresInspection?: boolean;
    kitId?: string | null;
    active?: boolean;
  }) {
    const active = input.active ?? true;
    await this.assertKitForType(input.kitId, active);
    return this.db.hotelRoomType.create({
      data: {
        name: input.name,
        beds: input.beds ?? 1,
        capacity: input.capacity ?? 2,
        description: input.description ?? null,
        requiresInspection: input.requiresInspection ?? false,
        kitId: input.kitId ?? null,
        active,
      },
    });
  }

  async updateRoomType(caller: Caller, id: string, input: HotelRoomTypeUpdateInput) {
    const type = await this.db.hotelRoomType.findUnique({ where: { id } });
    if (!type) throw new HttpError(404, "HOTEL_ROOM_TYPE_NOT_FOUND");
    const active = input.active ?? type.active;
    const kitId = input.kitId !== undefined ? input.kitId : type.kitId;
    await this.assertKitForType(kitId, active);
    if (active === false) {
      const rooms = await this.db.hotelRoom.count({ where: { typeId: id, active: true } });
      if (rooms > 0) throw new HttpError(409, "HOTEL_ROOM_TYPE_IN_USE");
    }
    const updated = await this.db.hotelRoomType.update({
      where: { id },
      data: {
        name: input.name,
        beds: input.beds,
        capacity: input.capacity,
        description: input.description,
        requiresInspection: input.requiresInspection,
        kitId: input.kitId === undefined ? undefined : input.kitId,
        active: input.active,
      },
    });
    await this.audit?.({
      action: "HOTEL_ROOM_TYPE_UPDATED",
      entityType: "HotelRoomType",
      entityId: id,
      userId: caller.id,
      metadata: { after: updated },
    });
    return updated;
  }

  async removeRoomType(caller: Caller, id: string) {
    const type = await this.db.hotelRoomType.findUnique({ where: { id } });
    if (!type) throw new HttpError(404, "HOTEL_ROOM_TYPE_NOT_FOUND");
    const rooms = await this.db.hotelRoom.count({ where: { typeId: id, active: true } });
    if (rooms > 0) throw new HttpError(409, "HOTEL_ROOM_TYPE_IN_USE");
    const updated = await this.db.hotelRoomType.update({ where: { id }, data: { active: false } });
    await this.audit?.({
      action: "HOTEL_ROOM_TYPE_DISABLED",
      entityType: "HotelRoomType",
      entityId: id,
      userId: caller.id,
    });
    return updated;
  }

  // ── Habitaciones ───────────────────────────────────────────────────────────

  async rooms(caller: Caller, filters: { zoneId?: string; status?: string; includeInactive?: boolean } = {}) {
    const visible = await this.visibleZoneIds(caller, "hotel_rooms.view");
    if (filters.zoneId) await this.assertInScope(caller, filters.zoneId, "hotel_rooms.view");
    return this.db.hotelRoom.findMany({
      where: {
        ...(filters.includeInactive ? {} : { active: true }),
        ...(filters.zoneId ? { zoneId: filters.zoneId } : {}),
        ...(filters.status ? { status: filters.status as never } : {}),
        ...(visible ? { zoneId: { in: [...visible] } } : {}),
      },
      orderBy: [{ zone: { sortOrder: "asc" } }, { number: "asc" }],
      include: {
        zone: { select: { id: true, name: true, kind: true, parentId: true } },
        type: { select: { id: true, name: true, beds: true, capacity: true, kitId: true } },
      },
    });
  }

  async createRoom(
    caller: Caller,
    input: { zoneId: string; typeId: string; number: string; status?: "LIMPIEZA" | "DISPONIBLE"; notes?: string | null }
  ) {
    const [zone, type] = await Promise.all([
      this.db.hotelZone.findUnique({ where: { id: input.zoneId } }),
      this.db.hotelRoomType.findUnique({ where: { id: input.typeId } }),
    ]);
    if (!zone || !zone.active) throw new HttpError(404, "HOTEL_ZONE_NOT_FOUND");
    if (zone.kind !== "PISO") throw new HttpError(409, "HOTEL_ZONE_NOT_PISO");
    if (!type || !type.active) throw new HttpError(404, "HOTEL_ROOM_TYPE_NOT_FOUND");
    await this.assertInScope(caller, input.zoneId, "hotel_rooms.manage");

    return this.db.$transaction(async (tx) => {
      const room = await tx.hotelRoom.create({
        data: {
          zoneId: input.zoneId,
          typeId: input.typeId,
          number: input.number,
          status: input.status ?? "LIMPIEZA",
          notes: input.notes ?? null,
        },
      });
      await tx.hotelRoomStatusChange.create({
        data: {
          roomId: room.id,
          from: null,
          to: room.status,
          userId: caller.id,
          notes: "Alta de la habitación",
        },
      });
      await this.audit?.({
        action: "HOTEL_ROOM_CREATED",
        entityType: "HotelRoom",
        entityId: room.id,
        userId: caller.id,
        metadata: { zoneId: room.zoneId, number: room.number },
      });
      return room;
    });
  }

  async updateRoom(caller: Caller, id: string, input: { typeId?: string; number?: string; notes?: string | null; active?: boolean }) {
    const room = await this.db.hotelRoom.findUnique({ where: { id } });
    if (!room) throw new HttpError(404, "HOTEL_ROOM_NOT_FOUND");
    await this.assertInScope(caller, room.zoneId, "hotel_rooms.manage");
    if (input.typeId) {
      const type = await this.db.hotelRoomType.findUnique({ where: { id: input.typeId } });
      if (!type || !type.active) throw new HttpError(404, "HOTEL_ROOM_TYPE_NOT_FOUND");
    }
    const updated = await this.db.hotelRoom.update({
      where: { id },
      data: { typeId: input.typeId, number: input.number, notes: input.notes, active: input.active },
    });
    await this.audit?.({
      action: "HOTEL_ROOM_UPDATED",
      entityType: "HotelRoom",
      entityId: id,
      userId: caller.id,
      metadata: { after: updated },
    });
    return updated;
  }

  async removeRoom(caller: Caller, id: string) {
    const room = await this.db.hotelRoom.findUnique({ where: { id } });
    if (!room) throw new HttpError(404, "HOTEL_ROOM_NOT_FOUND");
    await this.assertInScope(caller, room.zoneId, "hotel_rooms.manage");
    const updated = await this.db.hotelRoom.update({ where: { id }, data: { active: false } });
    await this.audit?.({
      action: "HOTEL_ROOM_DISABLED",
      entityType: "HotelRoom",
      entityId: id,
      userId: caller.id,
    });
    return updated;
  }

  // ── Estado ─────────────────────────────────────────────────────────────────

  async changeStatus(caller: Caller, id: string, input: HotelRoomStatusInput) {
    const room = await this.db.hotelRoom.findUnique({
      where: { id },
      include: { type: { select: { id: true, kitId: true, kit: { select: { active: true } } } } },
    });
    if (!room || !room.active) throw new HttpError(404, "HOTEL_ROOM_NOT_FOUND");
    await this.assertInScope(caller, room.zoneId, "hotel_rooms.status");

    const from = room.status;
    const to = input.to;
    if (from === to) return room;

    // La regla vive en el catálogo `hotel_room_status_transitions` (editable).
    const rule = await this.db.hotelRoomStatusTransition.findFirst({
      where: { from, to, active: true },
    });
    if (!rule || rule.systemOnly) throw new HttpError(409, "HOTEL_ROOM_TRANSITION_INVALID");
    if (rule.permission && scopeOf(caller as never, rule.permission) === "NONE") {
      throw new HttpError(403, "HOTEL_ACCESS_DENIED");
    }
    // Check-out exige kit activo: sin él no se puede limpiar ni consumir.
    if (rule.requiresActiveKit && (!room.type.kitId || !room.type.kit?.active)) {
      throw new HttpError(409, "HOTEL_KIT_NOT_AVAILABLE");
    }
    if (rule.requiresReason) {
      if (!input.reasonId) throw new HttpError(422, "HOTEL_REASON_REQUIRED");
      const reason = await this.db.hotelReason.findFirst({
        where: { id: input.reasonId, kind: "ESTADO_HABITACION", active: true },
        select: { id: true },
      });
      if (!reason) throw new HttpError(422, "HOTEL_REASON_REQUIRED");
    }

    const updated = await this.db.$transaction(async (tx) => {
      const next = await tx.hotelRoom.update({
        where: { id },
        data: { status: to },
      });
      await tx.hotelRoomStatusChange.create({
        data: {
          roomId: id,
          from,
          to,
          userId: caller.id,
          reasonId: input.reasonId ?? null,
          notes: input.notes ?? null,
        },
      });
      await this.audit?.({
        action: "HOTEL_ROOM_STATUS_CHANGED",
        entityType: "HotelRoom",
        entityId: id,
        userId: caller.id,
        previousState: { status: from },
        newState: { status: to, reasonId: input.reasonId ?? null },
      });
      return next;
    });
    return updated;
  }

  async history(roomId: string) {
    return this.db.hotelRoomStatusChange.findMany({
      where: { roomId },
      orderBy: { createdAt: "desc" },
      include: {
        user: { select: { id: true, name: true } },
        reason: { select: { id: true, name: true } },
      },
    });
  }

  // ── Catálogo: transiciones y motivos ───────────────────────────────────────

  async statusTransitions() {
    return this.db.hotelRoomStatusTransition.findMany({
      orderBy: [{ from: "asc" }, { to: "asc" }],
    });
  }

  async createStatusTransition(caller: Caller, input: {
    from: string; to: string; requiresReason?: boolean; requiresActiveKit?: boolean;
    permission?: string; systemOnly?: boolean; active?: boolean;
  }) {
    const created = await this.db.hotelRoomStatusTransition.create({
      data: {
        from: input.from as never,
        to: input.to as never,
        requiresReason: input.requiresReason ?? false,
        requiresActiveKit: input.requiresActiveKit ?? false,
        permission: input.permission ?? "hotel_rooms.status",
        systemOnly: input.systemOnly ?? false,
        active: input.active ?? true,
      },
    });
    await this.audit?.({ action: "HOTEL_ROOM_TRANSITION_CREATED", entityType: "HotelRoomStatusTransition", entityId: created.id, userId: caller.id, metadata: { after: created } });
    return created;
  }

  async updateStatusTransition(caller: Caller, id: string, input: {
    requiresReason?: boolean; requiresActiveKit?: boolean; permission?: string; systemOnly?: boolean; active?: boolean;
  }) {
    const before = await this.db.hotelRoomStatusTransition.findUnique({ where: { id } });
    if (!before) throw new HttpError(404, "HOTEL_ROOM_TRANSITION_NOT_FOUND");
    const updated = await this.db.hotelRoomStatusTransition.update({ where: { id }, data: input });
    await this.audit?.({ action: "HOTEL_ROOM_TRANSITION_UPDATED", entityType: "HotelRoomStatusTransition", entityId: id, userId: caller.id, previousState: before, newState: updated });
    return updated;
  }

  async removeStatusTransition(caller: Caller, id: string) {
    const before = await this.db.hotelRoomStatusTransition.findUnique({ where: { id } });
    if (!before) throw new HttpError(404, "HOTEL_ROOM_TRANSITION_NOT_FOUND");
    await this.db.hotelRoomStatusTransition.delete({ where: { id } });
    await this.audit?.({ action: "HOTEL_ROOM_TRANSITION_DELETED", entityType: "HotelRoomStatusTransition", entityId: id, userId: caller.id, metadata: { before } });
    return { id };
  }

  async reasons(kind?: string) {
    return this.db.hotelReason.findMany({
      where: { ...(kind ? { kind: kind as never } : {}) },
      orderBy: [{ kind: "asc" }, { name: "asc" }],
    });
  }

  async createReason(caller: Caller, input: { kind: string; name: string; requiresNotes?: boolean; active?: boolean }) {
    const created = await this.db.hotelReason.create({
      data: {
        kind: input.kind as never,
        name: input.name,
        requiresNotes: input.requiresNotes ?? false,
        active: input.active ?? true,
      },
    });
    await this.audit?.({ action: "HOTEL_REASON_CREATED", entityType: "HotelReason", entityId: created.id, userId: caller.id, metadata: { after: created } });
    return created;
  }

  async updateReason(caller: Caller, id: string, input: { name?: string; requiresNotes?: boolean; active?: boolean }) {
    const before = await this.db.hotelReason.findUnique({ where: { id } });
    if (!before) throw new HttpError(404, "HOTEL_REASON_NOT_FOUND");
    const updated = await this.db.hotelReason.update({ where: { id }, data: input });
    await this.audit?.({ action: "HOTEL_REASON_UPDATED", entityType: "HotelReason", entityId: id, userId: caller.id, previousState: before, newState: updated });
    return updated;
  }

  async removeReason(caller: Caller, id: string) {
    const before = await this.db.hotelReason.findUnique({ where: { id } });
    if (!before) throw new HttpError(404, "HOTEL_REASON_NOT_FOUND");
    const updated = await this.db.hotelReason.update({ where: { id }, data: { active: false } });
    await this.audit?.({ action: "HOTEL_REASON_DISABLED", entityType: "HotelReason", entityId: id, userId: caller.id });
    return updated;
  }

  // ── Tablero ────────────────────────────────────────────────────────────────

  async board(caller: Caller) {
    const visible = await this.visibleZoneIds(caller, "hotel_rooms.view");
    const zones = await this.db.hotelZone.findMany({
      where: {
        active: true,
        ...(visible ? { id: { in: [...visible] } } : {}),
      },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      include: {
        parent: { select: { id: true, name: true, kind: true } },
        rooms: {
          where: { active: true },
          orderBy: { number: "asc" },
          include: {
            type: { select: { id: true, name: true, requiresInspection: true } },
          },
        },
      },
    });
    return zones.map((zone) => ({
      id: zone.id,
      name: zone.name,
      kind: zone.kind,
      parent: zone.parent,
      rooms: zone.rooms,
      counts: zone.rooms.reduce<Record<string, number>>((acc, room) => {
        acc[room.status] = (acc[room.status] ?? 0) + 1;
        return acc;
      }, {}),
    }));
  }
}
