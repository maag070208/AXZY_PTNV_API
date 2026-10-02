import { test, expect } from "./support/fixtures";
import { db, statusesInDb } from "./support/db";

/**
 * ENTRADA de piezas nuevas a un dispositivo que YA existe — "llegaron más".
 *
 * Es el mismo `STOCK_IN` del alta, expuesto por `POST /inventory/movements`:
 * crea unidades con su folio (no reutiliza piezas), las liga al renglón del
 * movimiento y sube el disponible en el kardex. Sin esto, un dispositivo dado de
 * alta con 2 piezas se quedaba en 2 para siempre.
 */
test.describe("ENTRADA de unidades a un dispositivo existente", () => {
  test("agrega unidades nuevas, con folio consecutivo y kardex cuadrado", async ({ inv, scenario }) => {
    const device = await scenario.device(2, { name: `Con entradas ${Date.now()}` });
    const typeBefore = await inv.type(scenario.type.id);

    const movement = await inv.addUnits(device.id, 3, { reason: "Compra de refacciones" });
    expect(movement.type).toBe("STOCK_IN");
    expect(movement.reason).toBe("Compra de refacciones");
    expect(movement.status).toBe("ACTIVE");

    // Las piezas nuevas se suman a las que ya había.
    const stock = await inv.stock(device.id);
    expect(stock).toMatchObject({ AVAILABLE: 5, active: 5, historical: 5 });
    expect(await statusesInDb(device.id)).toEqual({ AVAILABLE: 5 });

    // Los folios siguen la serie del tipo, sin repetir los del alta.
    const units = await inv.units(device.id);
    expect(units.map((u) => u.assetTag)).toEqual([
      `${scenario.type.assetTagPrefix}-0001`,
      `${scenario.type.assetTagPrefix}-0002`,
      `${scenario.type.assetTagPrefix}-0003`,
      `${scenario.type.assetTagPrefix}-0004`,
      `${scenario.type.assetTagPrefix}-0005`,
    ]);
    expect((await inv.type(scenario.type.id)).counter).toBe(typeBefore.counter + 3);

    // El renglón liga EXACTAMENTE las tres piezas que creó (el detalle del
    // movimiento trae las unidades; la respuesta del alta no las anida).
    const detail = await inv.viewMovement(movement.id);
    expect(detail.items).toHaveLength(1);
    expect(detail.items[0]).toMatchObject({ deviceId: device.id, quantity: 3 });
    expect(detail.items[0].units).toHaveLength(3);
    expect(detail.items[0].units.map((u) => u.deviceUnit.assetTag).sort()).toEqual([
      `${scenario.type.assetTagPrefix}-0003`,
      `${scenario.type.assetTagPrefix}-0004`,
      `${scenario.type.assetTagPrefix}-0005`,
    ]);

    // El kardex muestra las dos entradas y el saldo.
    const ledger = await inv.stockLedger(device.id);
    expect(ledger.rows).toHaveLength(2);
    expect(ledger.rows[1]).toMatchObject({ type: "STOCK_IN", stockIn: 3, balance: 5 });
    expect(ledger.stock.AVAILABLE).toBe(5);
  });

  test("captura la serie de las piezas nuevas, en orden y sin obligar", async ({ inv, scenario }) => {
    const device = await scenario.device(1, { name: `Entrada con series ${Date.now()}` });
    const serials = [`SN-${scenario.type.code}-A`, `SN-${scenario.type.code}-B`];

    // Dos piezas con serie y una sin ella: la serie es opcional por pieza.
    await inv.addUnits(device.id, 3, {
      units: [{ serialNumber: `  ${serials[0]}  ` }, { serialNumber: serials[1] }, {}],
    });

    const units = await inv.units(device.id);
    expect(units).toHaveLength(4);
    // Las series se aplican EN ORDEN a las piezas nuevas (las 3 últimas) y se
    // normalizan (sin espacios de sobra).
    expect(units.map((u) => u.serialNumber)).toEqual([null, serials[0], serials[1], null]);
    expect(await statusesInDb(device.id)).toEqual({ AVAILABLE: 4 });

    // La pieza sin serie se puede capturar después, desde el detalle.
    const pending = units[3];
    const updated = await inv.put(`/inventory/units/${pending.id}`, { serialNumber: "SN-TARDIA" });
    expect(updated.status).toBe(200);
    expect(updated.body).toMatchObject({ serialNumber: "SN-TARDIA" });
  });

  test("una serie repetida se explica con el activo que la tiene", async ({ inv, scenario }) => {
    const first = await scenario.device(1, { name: `Serie repetida A ${Date.now()}` });
    const second = await scenario.device(1, { name: `Serie repetida B ${Date.now()}` });
    const serial = `SN-DUP-${scenario.type.code}`;

    const created = await inv.addUnits(first.id, 1, { units: [{ serialNumber: serial }] });
    expect(created.items[0].quantity).toBe(1);

    const clash = await inv.post("/inventory/movements", {
      type: "STOCK_IN",
      items: [{ deviceId: second.id, quantity: 1, units: [{ serialNumber: serial.toLowerCase() }] }],
    });
    expect(clash.status).toBe(409);
    expect(clash.body).toMatchObject({ code: "SERIAL_NUMBER_TAKEN" });

    // La entrada que chocó no dejó piezas a medias.
    expect(await statusesInDb(second.id)).toEqual({ AVAILABLE: 1 });
  });

  test("la cantidad es obligatoria y tiene tope", async ({ inv, scenario }) => {
    const device = await scenario.device(1, { name: `Validación de entrada ${Date.now()}` });

    const sinCantidad = await inv.post("/inventory/movements", {
      type: "STOCK_IN",
      items: [{ deviceId: device.id }],
    });
    expect(sinCantidad.status).toBe(400);

    const cero = await inv.post("/inventory/movements", {
      type: "STOCK_IN",
      items: [{ deviceId: device.id, quantity: 0 }],
    });
    expect(cero.status).toBe(400);

    const exagerada = await inv.post("/inventory/movements", {
      type: "STOCK_IN",
      items: [{ deviceId: device.id, quantity: 5001 }],
    });
    expect(exagerada.status).toBe(400);

    // Nada de eso creó piezas.
    expect(await statusesInDb(device.id)).toEqual({ AVAILABLE: 1 });
  });

  test("la entrada es idempotente con la misma clave", async ({ inv, scenario }) => {
    const device = await scenario.device(1, { name: `Entrada idempotente ${Date.now()}` });
    const key = `e2e-entry-${scenario.type.code}`;

    const first = await inv.movement({
      type: "STOCK_IN",
      items: [{ deviceId: device.id, quantity: 2 }],
      idempotencyKey: key,
    });
    const again = await inv.movement({
      type: "STOCK_IN",
      items: [{ deviceId: device.id, quantity: 2 }],
      idempotencyKey: key,
    });

    expect(again.id).toBe(first.id);
    expect(await statusesInDb(device.id)).toEqual({ AVAILABLE: 3 });
  });

  test("un EMPLEADO no puede dar entrada; sin token es 401", async ({ invEmployee, invAnonymous, scenario }) => {
    const device = await scenario.device(1, { name: `Permisos de entrada ${Date.now()}` });

    const asEmployee = await invEmployee.post("/inventory/movements", {
      type: "STOCK_IN",
      items: [{ deviceId: device.id, quantity: 1 }],
    });
    expect(asEmployee.status).toBe(403);

    const anonymous = await invAnonymous.post("/inventory/movements", {
      type: "STOCK_IN",
      items: [{ deviceId: device.id, quantity: 1 }],
    });
    expect(anonymous.status).toBe(401);

    expect(await db.deviceUnit.count({ where: { deviceId: device.id } })).toBe(1);
  });
});
