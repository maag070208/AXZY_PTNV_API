import type { HotelWarehouseKind, PrismaClient } from "@prisma/client";
import { prismaClient } from "@core/config/database";
import { HttpError } from "@core/middlewares/error.middleware";
import { scopeOf } from "@core/permissions";
import { HotelRoomsService, type Caller } from "./rooms.service";

/**
 * Default locations created with each warehouse (M3 4.5, D4 of linen). The first one is the default.
 * HOLD = merchandise set aside for an invoice difference; DIRTY = dirty linen of the area;
 * LENT = lent towels; QUARANTINE = pieces waiting for a write-off decision or repair.
 */
export const DEFAULT_LOCATIONS: Record<HotelWarehouseKind, string[]> = {
  ADMIN: ["INITIAL"],
  CENTRAL: ["GENERAL", "HOLD"],
  ZONE: ["GENERAL", "DIRTY"],
  CART: ["CART"],
  LAUNDRY: ["DIRTY", "IN_PROCESS", "CLEAN", "QUARANTINE"],
  NEW_LINEN: ["GENERAL", "HOLD"],
  POINT: ["GENERAL", "DIRTY", "LENT"],
  SPA: ["GENERAL", "DIRTY"],
  EQUIPMENT: ["GENERAL"],
};

const CUSTODIAN_SELECT = { id: true, name: true, photoKey: true } as const;

/** Custodian as `{ id, name, photoUrl }` (no storage keys in responses). */
const withCustodian = <T extends { custodian: { id: string; name: string; photoKey: string | null } | null }>(row: T) => {
  const { custodian, ...rest } = row;
  return {
    ...rest,
    custodian: custodian
      ? { id: custodian.id, name: custodian.name, photoUrl: custodian.photoKey ? `/hr/${custodian.id}/photo/raw` : null }
      : null,
  };
};

export interface WarehouseCreateInput {
  code: string;
  name: string;
  kind?: HotelWarehouseKind;
  zoneId?: string | null;
  ownerId?: string | null;
  custodianId?: string | null;
}

/** Warehouses and their locations. Deletion is logical. */
export class HotelWarehouseService {
  constructor(
    private readonly db: PrismaClient = prismaClient,
    private readonly rooms: HotelRoomsService = new HotelRoomsService(prismaClient)
  ) {}

  /**
   * Warehouse ids the caller may see under `permission`. `null` = all (ALL scope).
   * AREA = warehouses of the zones they supervise (and their descendants);
   * OWN = their own cart; anything else = none.
   */
  async visibleWarehouseIds(caller: Caller, permission: string): Promise<string[] | null> {
    const scope = scopeOf(caller as never, permission);
    if (scope === "ALL") return null;
    if (scope === "OWN") {
      const carts = await this.db.hotelWarehouse.findMany({ where: { ownerId: caller.id }, select: { id: true } });
      return carts.map((w) => w.id);
    }
    if (scope === "AREA") {
      const zones = await this.rooms.visibleZoneIds(caller, permission);
      if (!zones || zones.size === 0) return [];
      const warehouses = await this.db.hotelWarehouse.findMany({
        where: { zoneId: { in: [...zones] } },
        select: { id: true },
      });
      return warehouses.map((w) => w.id);
    }
    return [];
  }

  /** Union of the warehouses visible under several permissions. `null` = all. */
  async visibleWarehouseIdsAny(caller: Caller, permissions: string[]): Promise<string[] | null> {
    const union = new Set<string>();
    for (const permission of permissions) {
      const ids = await this.visibleWarehouseIds(caller, permission);
      if (ids === null) return null;
      ids.forEach((id) => union.add(id));
    }
    return [...union];
  }

  /** 403 if any of the warehouses is outside the caller's scope. */
  async assertWarehousesVisible(caller: Caller, warehouseIds: Array<string | null | undefined>, permission: string): Promise<void> {
    const visible = await this.visibleWarehouseIds(caller, permission);
    if (!visible) return;
    for (const id of warehouseIds) {
      if (id && !visible.includes(id)) throw new HttpError(403, "HOTEL_ACCESS_DENIED");
    }
  }

  async list(includeInactive = false, visibleIds: string[] | null = null) {
    const rows = await this.db.hotelWarehouse.findMany({
      where: {
        ...(includeInactive ? {} : { active: true }),
        ...(visibleIds ? { id: { in: visibleIds } } : {}),
      },
      include: { locations: { where: { active: true }, orderBy: { code: "asc" } }, custodian: { select: CUSTODIAN_SELECT } },
      orderBy: { code: "asc" },
    });
    return rows.map(withCustodian);
  }

  /** Creates the warehouse with its default locations in one transaction. */
  async create(input: WarehouseCreateInput) {
    const kind = input.kind ?? "ZONE";
    if (kind === "CART" && !input.ownerId) throw new HttpError(422, "HOTEL_WAREHOUSE_OWNER_REQUIRED");
    if (kind !== "CART" && input.ownerId) throw new HttpError(422, "HOTEL_WAREHOUSE_OWNER_NOT_ALLOWED");

    try {
      return await this.db.$transaction(async (tx) => {
        const warehouse = await tx.hotelWarehouse.create({
          data: {
            code: input.code,
            name: input.name,
            kind,
            zoneId: input.zoneId ?? null,
            ownerId: input.ownerId ?? null,
            custodianId: input.custodianId ?? null,
          },
        });
        await tx.hotelLocation.createMany({
          data: DEFAULT_LOCATIONS[kind].map((code, index) => ({
            warehouseId: warehouse.id,
            code,
            isDefault: index === 0,
          })),
        });
        return warehouse;
      });
    } catch (err) {
      throw this.mapUnique(err, "HOTEL_WAREHOUSE_CODE_TAKEN");
    }
  }

  async update(
    id: string,
    input: { name?: string; kind?: HotelWarehouseKind; zoneId?: string | null; custodianId?: string | null; active?: boolean }
  ) {
    const current = await this.find(id);
    if (input.custodianId) {
      const user = await this.db.user.findUnique({ where: { id: input.custodianId }, select: { id: true } });
      if (!user) throw new HttpError(404, "USER_NOT_FOUND");
    }
    const kindChanges = input.kind !== undefined && input.kind !== current.kind;
    if (kindChanges) {
      // The kind drives locations and rules (carts need an owner), so it only changes while the warehouse is empty.
      if (input.kind === "CART" || current.kind === "CART") throw new HttpError(409, "HOTEL_WAREHOUSE_KIND_LOCKED");
      const stocked = await this.db.hotelStock.count({ where: { warehouseId: id, quantity: { not: 0 } } });
      if (stocked > 0) throw new HttpError(409, "HOTEL_WAREHOUSE_KIND_LOCKED");
    }
    try {
      return await this.db.$transaction(async (tx) => {
        const updated = await tx.hotelWarehouse.update({
          where: { id },
          data: input,
          include: { custodian: { select: CUSTODIAN_SELECT } },
        });
        if (kindChanges) {
          // Adds the default locations of the new kind that are missing.
          const have = new Set((await tx.hotelLocation.findMany({ where: { warehouseId: id }, select: { code: true } })).map((l) => l.code));
          const missing = DEFAULT_LOCATIONS[updated.kind].filter((code) => !have.has(code));
          if (missing.length > 0) {
            await tx.hotelLocation.createMany({ data: missing.map((code) => ({ warehouseId: id, code, isDefault: false })) });
          }
        }
        return withCustodian(updated);
      });
    } catch (err) {
      throw this.mapUnique(err, "HOTEL_WAREHOUSE_CONFLICT");
    }
  }

  /** Logical delete. */
  async remove(id: string) {
    await this.find(id);
    return this.db.hotelWarehouse.update({ where: { id }, data: { active: false } });
  }

  async addLocation(warehouseId: string, input: { code: string; name?: string | null }) {
    await this.find(warehouseId);
    try {
      return await this.db.hotelLocation.create({
        data: { warehouseId, code: input.code, name: input.name ?? null, isDefault: false },
      });
    } catch (err) {
      throw this.mapUnique(err, "HOTEL_LOCATION_CODE_TAKEN");
    }
  }

  private async find(id: string) {
    const warehouse = await this.db.hotelWarehouse.findUnique({ where: { id } });
    if (!warehouse) throw new HttpError(404, "HOTEL_WAREHOUSE_NOT_FOUND");
    return warehouse;
  }

  /** P2002: unique violations (code, a single active cart per owner, a single active laundry). */
  private mapUnique(
    err: unknown,
    code: "HOTEL_WAREHOUSE_CODE_TAKEN" | "HOTEL_WAREHOUSE_CONFLICT" | "HOTEL_LOCATION_CODE_TAKEN"
  ): unknown {
    if ((err as { code?: string })?.code === "P2002") return new HttpError(409, code);
    return err;
  }
}
