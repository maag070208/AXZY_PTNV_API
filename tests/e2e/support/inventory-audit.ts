import { expect } from "@playwright/test";
import type { Device, InventoryApi } from "./inventory-api";

/**
 * Corre el auditor y falla si algún ejemplo (`sample`) menciona el dispositivo
 * de la prueba. NO exige `ok === true` global: los descuadres heredados del
 * respaldo (BLINDAJE.md §0a) siguen ahí y son ajenos a la suite.
 */
export const expectAuditCleanForDevice = async (
  inv: InventoryApi,
  device: Device
): Promise<void> => {
  const result = await inv.audit();
  const markers = [device.name, device.brand, device.model].filter(
    (m): m is string => typeof m === "string" && m.length > 0
  );
  const offenders = result.checks.flatMap((check) =>
    check.samples.filter((sample) => markers.some((marker) => sample.includes(marker)))
  );
  expect(
    offenders,
    `El auditor reporta casos del dispositivo de la prueba: ${offenders.join(" | ")}`
  ).toEqual([]);
};
