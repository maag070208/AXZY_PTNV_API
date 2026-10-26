import { HttpError } from "@core/middlewares/error.middleware";

/**
 * Pure rules of the warehouse ledger (M3). No database access: the movement
 * service uses them inside its transaction, and the unit tests cover them.
 */

export type HotelMovementType =
  | "INITIAL_LOAD"
  | "INBOUND"
  | "TRANSFER"
  | "ROOM_CONSUMPTION"
  | "LINEN_EXCHANGE"
  | "ADJUST_IN"
  | "ADJUST_OUT"
  | "WRITE_OFF";

/** Sign applied to the source warehouse (-1, origin) and the target warehouse (+1, destination). */
export interface LedgerDeltas {
  source: -1 | 0;
  target: 1 | 0;
}

export const ledgerDeltas = (type: HotelMovementType): LedgerDeltas => {
  switch (type) {
    case "INITIAL_LOAD":
    case "INBOUND":
    case "ADJUST_IN":
      return { source: 0, target: 1 };
    case "TRANSFER":
    case "LINEN_EXCHANGE":
      return { source: -1, target: 1 };
    case "ROOM_CONSUMPTION":
    case "ADJUST_OUT":
    case "WRITE_OFF":
      return { source: -1, target: 0 };
  }
};

/** Cancelling a movement applies the opposite signs. */
export const invertDeltas = (deltas: LedgerDeltas): { source: 0 | 1; target: -1 | 0 } => ({
  source: deltas.source === -1 ? 1 : 0,
  target: deltas.target === 1 ? -1 : 0,
});

/** Types that come from room tasks or purchase receipts: they are not cancelled directly (M3 4.3). */
export const isCancellable = (type: HotelMovementType): boolean =>
  type !== "ROOM_CONSUMPTION" && type !== "LINEN_EXCHANGE";

/** Shape of a movement request before any stock is read. */
export interface MovementShapeInput {
  fromWarehouseId?: string | null;
  warehouseId?: string | null;
  roomId?: string | null;
  reasonId?: string | null;
  lines: Array<{ quantity: number }>;
}

export const assertMovementShape = (type: HotelMovementType, input: MovementShapeInput): void => {
  if (input.lines.length === 0) throw new HttpError(422, "HOTEL_MOVEMENT_LINES_REQUIRED");
  for (const line of input.lines) assertPositiveQuantity(line.quantity);

  const deltas = ledgerDeltas(type);
  if (deltas.source !== 0 && !input.fromWarehouseId) throw new HttpError(422, "HOTEL_MOVEMENT_SOURCE_REQUIRED");
  if (deltas.target !== 0 && !input.warehouseId) throw new HttpError(422, "HOTEL_MOVEMENT_TARGET_REQUIRED");
  if (deltas.source === 0 && input.fromWarehouseId) throw new HttpError(422, "HOTEL_MOVEMENT_SOURCE_NOT_ALLOWED");
  if (deltas.target === 0 && input.warehouseId) throw new HttpError(422, "HOTEL_MOVEMENT_TARGET_NOT_ALLOWED");
  if (type !== "TRANSFER" && type !== "LINEN_EXCHANGE" && input.fromWarehouseId && input.fromWarehouseId === input.warehouseId) {
    throw new HttpError(422, "HOTEL_MOVEMENT_SAME_WAREHOUSE");
  }
  if ((type === "ROOM_CONSUMPTION" || type === "LINEN_EXCHANGE") && !input.roomId) {
    throw new HttpError(422, "HOTEL_ROOM_REQUIRED");
  }
  if ((type === "ADJUST_IN" || type === "ADJUST_OUT" || type === "WRITE_OFF") && !input.reasonId) {
    throw new HttpError(422, "HOTEL_MOVEMENT_REASON_REQUIRED");
  }
};

export const assertPositiveQuantity = (quantity: number): void => {
  if (!Number.isFinite(quantity) || quantity <= 0) throw new HttpError(422, "HOTEL_QUANTITY_INVALID");
};

/** Stock never goes negative: a line that is not covered fails with 409 and the product and available amount. */
export const assertSufficientStock = (productId: string, available: number, required: number): void => {
  if (available < required) {
    throw new HttpError(409, "HOTEL_STOCK_INSUFFICIENT", { productId, available, required });
  }
};

/** A transfer within one warehouse must move between two different locations. */
export const assertDifferentLocations = (fromLocationId: string, toLocationId: string): void => {
  if (fromLocationId === toLocationId) throw new HttpError(422, "HOTEL_TRANSFER_SAME_LOCATION");
};

export interface LedgerMovement {
  type: HotelMovementType;
  fromWarehouseId: string | null;
  warehouseId: string | null;
  lines: Array<{ productId: string; quantity: number; fromLocationId: string | null; toLocationId: string | null }>;
}

export interface StockPosition {
  productId: string;
  warehouseId: string;
  locationId: string;
  quantity: number;
}

const positionKey = (productId: string, warehouseId: string, locationId: string) =>
  `${productId}|${warehouseId}|${locationId}`;

/** Expected stock per position, from the signed sum of active movement lines (M3 4.7). */
export const expectedStock = (movements: LedgerMovement[]): Map<string, StockPosition> => {
  const out = new Map<string, StockPosition>();
  const add = (productId: string, warehouseId: string, locationId: string, delta: number) => {
    const key = positionKey(productId, warehouseId, locationId);
    const current = out.get(key) ?? { productId, warehouseId, locationId, quantity: 0 };
    current.quantity += delta;
    out.set(key, current);
  };
  for (const movement of movements) {
    const deltas = ledgerDeltas(movement.type);
    for (const line of movement.lines) {
      if (deltas.source !== 0 && movement.fromWarehouseId && line.fromLocationId) {
        add(line.productId, movement.fromWarehouseId, line.fromLocationId, deltas.source * line.quantity);
      }
      if (deltas.target !== 0 && movement.warehouseId && line.toLocationId) {
        add(line.productId, movement.warehouseId, line.toLocationId, deltas.target * line.quantity);
      }
    }
  }
  return out;
};

export interface StockDifference extends StockPosition {
  expected: number;
  difference: number;
}

/** Positions where materialized stock and the ledger disagree. Missing rows count as zero. */
export const diffStock = (actual: StockPosition[], expected: Map<string, StockPosition>): StockDifference[] => {
  const actualByKey = new Map(actual.map((row) => [positionKey(row.productId, row.warehouseId, row.locationId), row]));
  const keys = new Set([...actualByKey.keys(), ...expected.keys()]);
  const diffs: StockDifference[] = [];
  for (const key of keys) {
    const a = actualByKey.get(key);
    const e = expected.get(key);
    const base = a ?? e!;
    const actualQty = a?.quantity ?? 0;
    const expectedQty = e?.quantity ?? 0;
    if (Math.abs(actualQty - expectedQty) > 1e-9) {
      diffs.push({ productId: base.productId, warehouseId: base.warehouseId, locationId: base.locationId, quantity: actualQty, expected: expectedQty, difference: actualQty - expectedQty });
    }
  }
  return diffs;
};
