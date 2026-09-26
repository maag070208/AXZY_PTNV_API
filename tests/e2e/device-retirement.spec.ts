import { test, expect } from "./support/fixtures";
import { statusesInDb } from "./support/db";

/**
 * Flujo BAJA — DISPOSITIVOS.md §15 a §17, §24 y §26.
 *
 * La baja retira unidades del inventario operativo. Siempre es un movimiento
 * con motivo, nunca una edición directa de cantidades, y sólo puede tomar
 * unidades que estén disponibles.
 */
test.describe("BAJA de inventario", () => {
  test("da de baja 2 unidades y las saca de la existencia activa", async ({ inv, scenario }) => {
    const device = await scenario.device(15);

    const movement = await inv.retire(device.id, 2, "Daño irreparable");

    expect(movement).toMatchObject({ type: "RETIREMENT", reason: "Daño irreparable", status: "ACTIVE" });
    expect(movement.items[0]).toMatchObject({ deviceId: device.id, quantity: 2 });

    // La baja sale de la existencia activa pero permanece en la histórica (§26).
    expect(await inv.stock(device.id)).toMatchObject({
      AVAILABLE: 13,
      RETIREMENT: 2,
      active: 13,
      historical: 15,
    });
    expect(await statusesInDb(device.id)).toEqual({ AVAILABLE: 13, RETIREMENT: 2 });
  });

  test("exige motivo", async ({ inv, scenario }) => {
    const device = await scenario.device(5);

    const res = await inv.post("/inventory/movements", {
      type: "RETIREMENT",
      items: [{ deviceId: device.id, quantity: 1 }],
    });

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ message: "Motivo requerido para la baja" });
    expect(await inv.stock(device.id)).toMatchObject({ AVAILABLE: 5, RETIREMENT: 0 });
  });

  test("exige al menos un detalle", async ({ inv }) => {
    const res = await inv.post("/inventory/movements", {
      type: "RETIREMENT",
      reason: "Sin detalles",
      items: [],
    });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ message: "Agrega al menos un detalle" });
  });

  test("no deja dar de baja más de lo disponible", async ({ inv, scenario }) => {
    const device = await scenario.device(5);

    const res = await inv.post("/inventory/movements", {
      type: "RETIREMENT",
      reason: "Intento excesivo",
      items: [{ deviceId: device.id, quantity: 8 }],
    });

    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({
      message: expect.stringContaining("se requieren 8, hay 5"),
    });
    expect(await inv.stock(device.id)).toMatchObject({ AVAILABLE: 5, RETIREMENT: 0 });
  });

  test("las unidades prestadas no se pueden dar de baja (§17)", async ({
    inv,
    scenario,
    departmentId,
  }) => {
    const device = await scenario.device(15);
    await inv.lend({
      departmentId,
      items: [{ deviceId: device.id, quantity: 10 }],
    });
    expect(await inv.stock(device.id)).toMatchObject({ AVAILABLE: 5, ON_LOAN: 10 });

    // 8 > las 5 disponibles: aunque existan 15 piezas, las prestadas no cuentan.
    const exceeded = await inv.post("/inventory/movements", {
      type: "RETIREMENT",
      reason: "Intento sobre prestadas",
      items: [{ deviceId: device.id, quantity: 8 }],
    });
    expect(exceeded.status).toBe(409);
    expect(await inv.stock(device.id)).toMatchObject({ AVAILABLE: 5, ON_LOAN: 10, RETIREMENT: 0 });

    // El máximo permitido sí pasa.
    await inv.retire(device.id, 5, "Obsoletas");
    expect(await inv.stock(device.id)).toMatchObject({
      AVAILABLE: 0,
      ON_LOAN: 10,
      RETIREMENT: 5,
      active: 10,
      historical: 15,
    });
  });

  test("no deja dar de baja una unidad prestada aunque se indique por id", async ({
    inv,
    scenario,
    departmentId,
  }) => {
    const device = await scenario.device(4);
    await inv.lend({ departmentId, items: [{ deviceId: device.id, quantity: 2 }] });
    const loaned = (await inv.units(device.id)).find((u) => u.status === "ON_LOAN")!;

    const res = await inv.post("/inventory/movements", {
      type: "RETIREMENT",
      reason: "Intento directo",
      items: [{ deviceId: device.id, quantity: 1, unitId: loaned.id }],
    });

    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({
      message: `La unidad ${loaned.assetTag} está en estado PRESTADO; se esperaba DISPONIBLE`,
    });
    expect(await inv.stock(device.id)).toMatchObject({ ON_LOAN: 2, RETIREMENT: 0 });
  });

  test("da de baja exactamente la unidad indicada", async ({ inv, scenario }) => {
    const device = await scenario.device(5);
    const selected = (await inv.units(device.id))[4];

    await inv.retire(device.id, 1, "Robo", selected.id);

    const after = await inv.units(device.id);
    expect(after.find((u) => u.id === selected.id)?.status).toBe("RETIREMENT");
    expect(after.filter((u) => u.status === "RETIREMENT")).toHaveLength(1);
  });

  test("una baja con varios dispositivos valida cada detalle por separado", async ({
    inv,
    scenario,
  }) => {
    const samsung = await scenario.device(13);
    const ipad = await scenario.device(20);

    const movement = await inv.movement({
      type: "RETIREMENT",
      reason: "Retiro de lote",
      items: [
        { deviceId: samsung.id, quantity: 5 },
        { deviceId: ipad.id, quantity: 10 },
      ],
    });

    expect(movement.items).toHaveLength(2);
    expect(await inv.stock(samsung.id)).toMatchObject({ AVAILABLE: 8, RETIREMENT: 5 });
    expect(await inv.stock(ipad.id)).toMatchObject({ AVAILABLE: 10, RETIREMENT: 10 });
  });

  test("si un detalle no alcanza, no se da de baja ninguno", async ({ inv, scenario }) => {
    const enough = await scenario.device(10);
    const scarce = await scenario.device(2);

    const res = await inv.post("/inventory/movements", {
      type: "RETIREMENT",
      reason: "Lote mixto",
      items: [
        { deviceId: enough.id, quantity: 3 },
        { deviceId: scarce.id, quantity: 7 },
      ],
    });

    expect(res.status).toBe(409);
    expect(await inv.stock(enough.id)).toMatchObject({ AVAILABLE: 10, RETIREMENT: 0 });
    expect(await inv.stock(scarce.id)).toMatchObject({ AVAILABLE: 2, RETIREMENT: 0 });
  });

  test("una unidad dada de baja ya no se puede prestar", async ({
    inv,
    scenario,
    departmentId,
  }) => {
    const device = await scenario.device(3);
    await inv.retire(device.id, 3, "Fin de vida útil");

    const res = await inv.post("/inventory/loans", {
      departmentId,
      items: [{ deviceId: device.id, quantity: 1 }],
    });

    expect(res.status).toBe(409);
    expect(await inv.stock(device.id)).toMatchObject({
      AVAILABLE: 0,
      RETIREMENT: 3,
      active: 0,
      historical: 3,
    });
  });

  test("la baja queda en el histórico y en el kardex, nunca se borra", async ({
    inv,
    scenario,
  }) => {
    const device = await scenario.device(10);
    await inv.retire(device.id, 4, "Daño por agua");

    const movements = await inv.listMovements({ deviceId: device.id, type: "RETIREMENT" });
    expect(movements).toHaveLength(1);
    expect(movements[0]).toMatchObject({ reason: "Daño por agua", status: "ACTIVE" });

    const stockLedger = await inv.stockLedger(device.id);
    expect(stockLedger.rows.map((r) => [r.type, r.stockIn, r.stockOut, r.balance])).toEqual([
      ["STOCK_IN", 10, 0, 10],
      ["RETIREMENT", 0, 4, 6],
    ]);
  });

  test("la baja de una unidad dañada pasa por mantenimiento", async ({ inv, scenario }) => {
    // Una unidad DANADO no es DISPONIBLE, así que la baja directa no la alcanza:
    // el camino es mantenimiento → salida ROTO, que sí la da de baja.
    const device = await scenario.device(4);
    await inv.sendToMaintenance(device.id, 2);
    await inv.removeFromMaintenance(device.id, 2, "POOR");
    expect(await inv.stock(device.id)).toMatchObject({ AVAILABLE: 2, DAMAGED: 2 });

    const direct = await inv.post("/inventory/movements", {
      type: "RETIREMENT",
      reason: "Intento sobre dañadas",
      items: [{ deviceId: device.id, quantity: 3 }],
    });
    expect(direct.status).toBe(409);

    await inv.retire(device.id, 2, "Retiro de las sanas");
    expect(await inv.stock(device.id)).toMatchObject({
      AVAILABLE: 0,
      DAMAGED: 2,
      RETIREMENT: 2,
      active: 2,
      historical: 4,
    });
  });

  test("un EMPLEADO no puede dar de baja", async ({ invEmployee, scenario, inv }) => {
    const device = await scenario.device(3);

    const res = await invEmployee.post("/inventory/movements", {
      type: "RETIREMENT",
      reason: "No autorizado",
      items: [{ deviceId: device.id, quantity: 1 }],
    });

    expect(res.status).toBe(403);
    expect(await inv.stock(device.id)).toMatchObject({ AVAILABLE: 3, RETIREMENT: 0 });
  });
});
