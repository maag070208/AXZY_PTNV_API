/** Reglas puras de la dotación por componente (sin base de datos). */

export const ROOM_COMPONENTS = ["ROOM", "KING_BED", "QUEEN_BED", "SOFA_BED", "BATHROOM"] as const;
export type RoomComponent = (typeof ROOM_COMPONENTS)[number];

export interface RoomComposition {
  kingBeds: number;
  queenBeds: number;
  sofaBeds: number;
  bathrooms: number;
}

export interface RoomParLine {
  component: string;
  productId: string;
  quantity: number;
}

export const MAX_PAR_QUANTITY = 999;

/** Cuántas veces aplica cada componente en una habitación. */
export const componentMultiplier = (room: RoomComposition, component: RoomComponent): number => {
  switch (component) {
    case "ROOM":
      return 1;
    case "KING_BED":
      return room.kingBeds;
    case "QUEEN_BED":
      return room.queenBeds;
    case "SOFA_BED":
      return room.sofaBeds;
    case "BATHROOM":
      return room.bathrooms;
  }
};

/** Esperado por producto = Σ cantidad × multiplicador del componente; omite los resultados en 0. */
export const expectedForRoom = (room: RoomComposition, pars: RoomParLine[]): Map<string, number> => {
  const out = new Map<string, number>();
  for (const par of pars) {
    if (!(ROOM_COMPONENTS as readonly string[]).includes(par.component)) continue;
    const total = par.quantity * componentMultiplier(room, par.component as RoomComponent);
    if (total === 0) continue;
    out.set(par.productId, (out.get(par.productId) ?? 0) + total);
  }
  return out;
};

export type RoomParLineErrorCode =
  | "HOTEL_ROOM_PAR_COMPONENT_INVALID"
  | "HOTEL_ROOM_PAR_PRODUCT_REQUIRED"
  | "HOTEL_ROOM_PAR_QUANTITY_INVALID"
  | "HOTEL_ROOM_PAR_DUPLICATE";

export interface RoomParLineError {
  index: number;
  code: RoomParLineErrorCode;
}

/** Valida los renglones capturados; devuelve la lista de errores (vacía si todo está bien). */
export const validateRoomParLines = (lines: RoomParLine[]): RoomParLineError[] => {
  const errors: RoomParLineError[] = [];
  const seen = new Set<string>();
  lines.forEach((line, index) => {
    if (!(ROOM_COMPONENTS as readonly string[]).includes(line.component)) {
      errors.push({ index, code: "HOTEL_ROOM_PAR_COMPONENT_INVALID" });
      return;
    }
    if (typeof line.productId !== "string" || line.productId.trim() === "") {
      errors.push({ index, code: "HOTEL_ROOM_PAR_PRODUCT_REQUIRED" });
      return;
    }
    if (!Number.isInteger(line.quantity) || line.quantity < 0 || line.quantity > MAX_PAR_QUANTITY) {
      errors.push({ index, code: "HOTEL_ROOM_PAR_QUANTITY_INVALID" });
      return;
    }
    const key = `${line.component}:${line.productId}`;
    if (seen.has(key)) errors.push({ index, code: "HOTEL_ROOM_PAR_DUPLICATE" });
    seen.add(key);
  });
  return errors;
};
