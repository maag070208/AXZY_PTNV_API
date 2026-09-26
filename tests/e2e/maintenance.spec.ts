import { test, expect } from "./support/fixtures";
import { db, statusesInDb } from "./support/db";

/**
 * Flujo MOVIMIENTOS DE MANTENIMIENTO — DISPOSITIVOS.md §7, §23 a §26.
 *
 * MANTENIMIENTO_ENTRADA saca unidades de disponibles y las deja en taller;
 * MANTENIMIENTO_SALIDA las regresa según la condición con la que vuelven.
 * La reversión es el mecanismo de cancelación: no se borran movimientos.
 */
test.describe("MOVIMIENTOS DE MANTENIMIENTO", () => {
  test("la entrada a mantenimiento descuenta disponibles sin tocar la existencia activa", async ({
    inv,
    scenario,
  }) => {
    const device = await scenario.device(10);

    const movement = await inv.sendToMaintenance(device.id, 3, "Revisión preventiva");

    expect(movement).toMatchObject({
      type: "MAINTENANCE_IN",
      reason: "Revisión preventiva",
      status: "ACTIVE",
    });
    expect(await inv.stock(device.id)).toMatchObject({
      AVAILABLE: 7,
      IN_MAINTENANCE: 3,
      active: 10,
      historical: 10,
    });
    expect(await statusesInDb(device.id)).toEqual({ AVAILABLE: 7, IN_MAINTENANCE: 3 });
  });

  test("la salida en buen estado regresa las unidades a disponibles", async ({ inv, scenario }) => {
    const device = await scenario.device(10);
    await inv.sendToMaintenance(device.id, 4);

    await inv.removeFromMaintenance(device.id, 2, "GOOD");
    expect(await inv.stock(device.id)).toMatchObject({ AVAILABLE: 8, IN_MAINTENANCE: 2 });

    await inv.removeFromMaintenance(device.id, 2, "FAIR");
    expect(await inv.stock(device.id)).toMatchObject({
      AVAILABLE: 10,
      IN_MAINTENANCE: 0,
      active: 10,
    });
  });

  test("la salida en mal estado deja la unidad como dañada", async ({ inv, scenario }) => {
    const device = await scenario.device(6);
    await inv.sendToMaintenance(device.id, 3);

    await inv.removeFromMaintenance(device.id, 2, "POOR");

    expect(await inv.stock(device.id)).toMatchObject({
      AVAILABLE: 3,
      IN_MAINTENANCE: 1,
      DAMAGED: 2,
      active: 6,
      historical: 6,
    });
  });

  test("la salida como ROTO da de baja la unidad y registra el movimiento automático", async ({
    inv,
    scenario,
  }) => {
    const device = await scenario.device(6);
    await inv.sendToMaintenance(device.id, 3);

    await inv.movement({
      type: "MAINTENANCE_OUT",
      items: [
        {
          deviceId: device.id,
          quantity: 2,
          condition: "BROKEN",
          notes: "Sin refacciones",
        },
      ],
    });

    expect(await inv.stock(device.id)).toMatchObject({
      AVAILABLE: 3,
      IN_MAINTENANCE: 1,
      RETIREMENT: 2,
      active: 4,
      historical: 6,
    });

    const retirements = await inv.listMovements({ deviceId: device.id, type: "RETIREMENT" });
    expect(retirements).toHaveLength(1);
    expect(retirements[0].reason).toBe("Baja automática por estado ROTO");
  });

  test("la salida sin condición asume que la unidad vuelve utilizable", async ({
    inv,
    scenario,
  }) => {
    const device = await scenario.device(5);
    await inv.sendToMaintenance(device.id, 2);

    await inv.movement({
      type: "MAINTENANCE_OUT",
      items: [{ deviceId: device.id, quantity: 2 }],
    });

    expect(await inv.stock(device.id)).toMatchObject({ AVAILABLE: 5, IN_MAINTENANCE: 0 });
  });

  test.describe("unidad física específica", () => {
    test("manda a mantenimiento exactamente la unidad indicada", async ({ inv, scenario }) => {
      const device = await scenario.device(5);
      const units = await inv.units(device.id);
      const selected = units[3];

      await inv.sendToMaintenance(device.id, 1, "Falla puntual", selected.id);

      const after = await inv.units(device.id);
      expect(after.find((u) => u.id === selected.id)?.status).toBe("IN_MAINTENANCE");
      expect(after.filter((u) => u.status === "IN_MAINTENANCE")).toHaveLength(1);

      // El movimiento deja registrada la unidad exacta, no solo la cantidad.
      const linked = await db.movementItemUnit.findMany({
        where: { deviceUnitId: selected.id },
      });
      expect(linked).toHaveLength(1);
    });

    test("rechaza la unidad que no está en el estado esperado", async ({ inv, scenario }) => {
      const device = await scenario.device(4);
      const [unit] = await inv.units(device.id);
      await inv.sendToMaintenance(device.id, 1, "Primera vez", unit.id);

      const res = await inv.post("/inventory/movements", {
        type: "MAINTENANCE_IN",
        items: [{ deviceId: device.id, quantity: 1, unitId: unit.id }],
      });

      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({
        message: `La unidad ${unit.assetTag} está en estado MANTENIMIENTO; se esperaba DISPONIBLE`,
      });
    });

    test("rechaza la unidad que pertenece a otro dispositivo", async ({ inv, scenario }) => {
      const one = await scenario.device(3);
      const other = await scenario.device(3);
      const [unitOfOther] = await inv.units(other.id);

      const res = await inv.post("/inventory/movements", {
        type: "MAINTENANCE_IN",
        items: [{ deviceId: one.id, quantity: 1, unitId: unitOfOther.id }],
      });

      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({
        message: "La unidad no pertenece al dispositivo seleccionado",
      });
      expect(await inv.stock(one.id)).toMatchObject({ AVAILABLE: 3 });
      expect(await inv.stock(other.id)).toMatchObject({ AVAILABLE: 3 });
    });

    test("una unidad específica no puede mover más de una pieza", async ({ inv, scenario }) => {
      const device = await scenario.device(5);
      const [unit] = await inv.units(device.id);

      const res = await inv.post("/inventory/movements", {
        type: "MAINTENANCE_IN",
        items: [{ deviceId: device.id, quantity: 2, unitId: unit.id }],
      });

      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({
        message: "La selección de unidad física aplica a una sola unidad",
      });
    });
  });

  test.describe("validaciones", () => {
    test("no deja enviar a mantenimiento más de lo disponible", async ({ inv, scenario }) => {
      const device = await scenario.device(3);

      const res = await inv.post("/inventory/movements", {
        type: "MAINTENANCE_IN",
        items: [{ deviceId: device.id, quantity: 5 }],
      });

      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({
        message: expect.stringContaining("se requieren 5, hay 3"),
      });
      expect(await inv.stock(device.id)).toMatchObject({ AVAILABLE: 3, IN_MAINTENANCE: 0 });
    });

    test("no deja sacar de mantenimiento lo que nunca entró", async ({ inv, scenario }) => {
      const device = await scenario.device(4);
      await inv.sendToMaintenance(device.id, 1);

      const res = await inv.post("/inventory/movements", {
        type: "MAINTENANCE_OUT",
        items: [{ deviceId: device.id, quantity: 3, condition: "GOOD" }],
      });

      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({
        message: expect.stringContaining("No hay suficientes unidades en mantenimiento"),
      });
      expect(await inv.stock(device.id)).toMatchObject({ AVAILABLE: 3, IN_MAINTENANCE: 1 });
    });

    test("rechaza una condición fuera del catálogo", async ({ inv, scenario }) => {
      const device = await scenario.device(3);
      await inv.sendToMaintenance(device.id, 1);

      const res = await inv.post("/inventory/movements", {
        type: "MAINTENANCE_OUT",
        items: [{ deviceId: device.id, quantity: 1, condition: "EXCELLENT" }],
      });
      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ error: "ValidationError" });
    });

    test("rechaza un dispositivo inexistente", async ({ inv }) => {
      const res = await inv.post("/inventory/movements", {
        type: "MAINTENANCE_IN",
        items: [
          { deviceId: "00000000-0000-0000-0000-000000000000", quantity: 1 },
        ],
      });
      expect(res.status).toBe(404);
    });
  });

  test.describe("reversión", () => {
    test("revertir una entrada regresa las unidades y cancela el movimiento original", async ({
      inv,
      scenario,
    }) => {
      const device = await scenario.device(8);
      const stockIn = await inv.sendToMaintenance(device.id, 3, "Enviado por error");
      expect(await inv.stock(device.id)).toMatchObject({ AVAILABLE: 5, IN_MAINTENANCE: 3 });

      const reversion = await inv.revert(stockIn.id);

      expect(reversion).toMatchObject({
        type: "REVERSAL",
        reason: "Reversión de MANTENIMIENTO_ENTRADA",
        reversalOfId: stockIn.id,
      });
      expect(await inv.stock(device.id)).toMatchObject({
        AVAILABLE: 8,
        IN_MAINTENANCE: 0,
      });

      // El histórico se conserva: el original queda CANCELADO, no borrado (§24).
      expect((await inv.viewMovement(stockIn.id)).status).toBe("CANCELLED");
      expect(await inv.listMovements({ deviceId: device.id })).toHaveLength(3);
    });

    test("revertir una salida devuelve las unidades al taller", async ({ inv, scenario }) => {
      const device = await scenario.device(6);
      await inv.sendToMaintenance(device.id, 4);
      const stockOut = await inv.removeFromMaintenance(device.id, 3, "GOOD");
      expect(await inv.stock(device.id)).toMatchObject({ AVAILABLE: 5, IN_MAINTENANCE: 1 });

      await inv.revert(stockOut.id);

      expect(await inv.stock(device.id)).toMatchObject({
        AVAILABLE: 2,
        IN_MAINTENANCE: 4,
        active: 6,
      });
    });

    test("revertir la entrada de una unidad específica devuelve esa misma unidad", async ({
      inv,
      scenario,
    }) => {
      const device = await scenario.device(5);
      const units = await inv.units(device.id);
      const selected = units[2];
      const stockIn = await inv.sendToMaintenance(device.id, 1, "Puntual", selected.id);

      await inv.revert(stockIn.id);

      const after = await inv.units(device.id);
      expect(after.find((u) => u.id === selected.id)?.status).toBe("AVAILABLE");
      expect(after.filter((u) => u.status === "IN_MAINTENANCE")).toHaveLength(0);
    });

    test("un movimiento no se puede revertir dos veces", async ({ inv, scenario }) => {
      const device = await scenario.device(5);
      const stockIn = await inv.sendToMaintenance(device.id, 2);
      await inv.revert(stockIn.id);

      const res = await inv.post(`/inventory/movements/${stockIn.id}/revert`);
      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({ message: "El movimiento ya fue revertido" });
      expect(await inv.stock(device.id)).toMatchObject({ AVAILABLE: 5 });
    });

    test("una baja no admite reversión", async ({ inv, scenario }) => {
      const device = await scenario.device(5);
      const retirement = await inv.retire(device.id, 1, "Daño irreparable");

      const res = await inv.post(`/inventory/movements/${retirement.id}/revert`);
      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({
        message: "Este tipo de movimiento no admite reversión",
      });
      expect(await inv.stock(device.id)).toMatchObject({ RETIREMENT: 1, AVAILABLE: 4 });
    });

    test("revertir un movimiento inexistente da 404", async ({ inv }) => {
      const res = await inv.post(
        "/inventory/movements/00000000-0000-0000-0000-000000000000/revert"
      );
      expect(res.status).toBe(404);
    });
  });

  test("el kardex refleja entradas y salidas de mantenimiento", async ({ inv, scenario }) => {
    const device = await scenario.device(10);
    await inv.sendToMaintenance(device.id, 4, "Revisión");
    await inv.removeFromMaintenance(device.id, 4, "GOOD");

    const stockLedger = await inv.stockLedger(device.id);
    expect(stockLedger.rows.map((r) => [r.type, r.stockIn, r.stockOut, r.balance])).toEqual([
      ["STOCK_IN", 10, 0, 10],
      ["MAINTENANCE_IN", 0, 4, 6],
      ["MAINTENANCE_OUT", 4, 0, 10],
    ]);
    expect(stockLedger.stock).toMatchObject({ AVAILABLE: 10, IN_MAINTENANCE: 0 });
  });

  test("un EMPLEADO no puede mover ni revertir mantenimiento", async ({
    inv,
    invEmployee,
    scenario,
  }) => {
    const device = await scenario.device(4);
    const stockIn = await inv.sendToMaintenance(device.id, 1);

    expect(
      (
        await invEmployee.post("/inventory/movements", {
          type: "MAINTENANCE_IN",
          items: [{ deviceId: device.id, quantity: 1 }],
        })
      ).status
    ).toBe(403);

    expect((await invEmployee.post(`/inventory/movements/${stockIn.id}/revert`)).status).toBe(403);
    expect(await inv.stock(device.id)).toMatchObject({ IN_MAINTENANCE: 1 });
  });
});
