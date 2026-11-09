import { HttpError } from "@core/middlewares/error.middleware";

/** Reglas puras de los equipos por pieza: etiquetas, transiciones de estado y resultado de la devolución. */

export type EquipmentStatus = "AVAILABLE" | "LOANED" | "IN_REPAIR" | "MISSING" | "RETIRED";
export type EquipmentCondition = "GOOD" | "DAMAGED" | "MISSING";

const TAG_PAD = 3;

/** Etiqueta `PREFIJO-001`. */
export const formatTag = (prefix: string, n: number): string => `${prefix}-${String(n).padStart(TAG_PAD, "0")}`;

/** Consecutivo de una etiqueta existente del prefijo (null si no es del prefijo). */
export const tagNumber = (prefix: string, tag: string): number | null => {
  const match = new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}-(\\d+)$`).exec(tag);
  return match ? Number(match[1]) : null;
};

/** Las `count` etiquetas siguientes del prefijo: máximo existente + 1 en adelante (nunca reutiliza huecos). */
export const nextTags = (prefix: string, existingTags: string[], count: number): string[] => {
  const max = existingTags.reduce((m, t) => Math.max(m, tagNumber(prefix, t) ?? 0), 0);
  return Array.from({ length: count }, (_, i) => formatTag(prefix, max + i + 1));
};

/** Cambios manuales de estado (PATCH): retirar o reactivar. LOANED solo se resuelve devolviendo. */
const MANUAL: Record<EquipmentStatus, EquipmentStatus[]> = {
  AVAILABLE: ["RETIRED"],
  IN_REPAIR: ["RETIRED"],
  MISSING: ["AVAILABLE", "RETIRED"],
  RETIRED: ["AVAILABLE"],
  LOANED: [],
};

export const assertManualTransition = (from: EquipmentStatus, to: EquipmentStatus): void => {
  if (!MANUAL[from].includes(to)) throw new HttpError(409, "HOTEL_EQUIPMENT_STATUS_INVALID", { from, to });
};

/** Solo una pieza disponible se presta. */
export const assertAvailable = (status: EquipmentStatus): void => {
  if (status !== "AVAILABLE") throw new HttpError(409, "HOTEL_EQUIPMENT_UNIT_UNAVAILABLE", { status });
};

/** Estado de la pieza según cómo regresa: bien -> disponible; dañada -> reparación; no regresó -> extraviada. */
export const statusAfterReturn = (condition: EquipmentCondition): EquipmentStatus =>
  condition === "GOOD" ? "AVAILABLE" : condition === "DAMAGED" ? "IN_REPAIR" : "MISSING";

/** Solo una pieza en reparación vuelve a disponible con "reparado". */
export const assertRepairable = (status: EquipmentStatus): void => {
  if (status !== "IN_REPAIR") throw new HttpError(409, "HOTEL_EQUIPMENT_STATUS_INVALID", { from: status, to: "AVAILABLE" });
};
