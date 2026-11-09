/**
 * D8: destino del sucio de un carro. El LINEN_EXCHANGE va a la ubicación DIRTY del almacén ZONE
 * del área del carro: se busca por la zona del carro y, si no hay, por la de la habitación,
 * subiendo en cada caso por el árbol de zonas. Sin coincidencia -> null (cae a lavandería).
 */
export const resolveDirtyWarehouse = (input: {
  cartZoneId: string | null;
  roomZoneId: string | null;
  zones: Array<{ id: string; parentId: string | null }>;
  zoneWarehouses: Array<{ id: string; zoneId: string | null }>;
}): string | null => {
  const parentOf = new Map(input.zones.map((z) => [z.id, z.parentId]));
  const warehouseOf = new Map<string, string>();
  for (const w of input.zoneWarehouses) if (w.zoneId && !warehouseOf.has(w.zoneId)) warehouseOf.set(w.zoneId, w.id);
  for (const start of [input.cartZoneId, input.roomZoneId]) {
    const seen = new Set<string>();
    let current: string | null | undefined = start;
    while (current && !seen.has(current)) {
      seen.add(current);
      const found = warehouseOf.get(current);
      if (found) return found;
      current = parentOf.get(current);
    }
  }
  return null;
};
