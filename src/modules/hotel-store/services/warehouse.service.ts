import type { HotelWarehouseKind, PrismaClient } from "@prisma/client";
import { prismaClient } from "@core/config/database";
import { HttpError } from "@core/middlewares/error.middleware";

/** Default locations created with each warehouse (M3 4.5). The first one is the default. */
const DEFAULT_LOCATIONS: Record<HotelWarehouseKind, string[]> = {
  ADMIN: ["INITIAL"],
  CENTRAL: ["GENERAL"],
  ZONE: ["GENERAL"],
  CART: ["CART"],
  LAUNDRY: ["DIRTY", "IN_PROCESS", "CLEAN"],
};

export interface WarehouseCreateInput {
  code: string;
  name: string;
  kind?: HotelWarehouseKind;
  zoneId?: string | null;
  ownerId?: string | null;
}

/** Warehouses and their locations. Deletion is logical. */
export class HotelWarehouseService {
  constructor(private readonly db: PrismaClient = prismaClient) {}

  list(includeInactive = false) {
    return this.db.hotelWarehouse.findMany({
      where: includeInactive ? {} : { active: true },
      include: { locations: { where: { active: true }, orderBy: { code: "asc" } } },
      orderBy: { code: "asc" },
    });
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

  async update(id: string, input: { name?: string; zoneId?: string | null; active?: boolean }) {
    await this.find(id);
    try {
      return await this.db.hotelWarehouse.update({ where: { id }, data: input });
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
