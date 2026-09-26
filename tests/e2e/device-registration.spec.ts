import { test, expect } from "./support/fixtures";
import { db, statusesInDb } from "./support/db";

/**
 * Flujo ALTA — DISPOSITIVOS.md §4, §5, §18.
 *
 * El alta entra por `POST /inventario/dispositivos`: crea el dispositivo, una
 * unidad física por cada pieza (con su folio de activo fijo) y el movimiento de
 * ENTRADA que respalda las existencias.
 */
test.describe("ALTA de inventario", () => {
  test("el alta de un tipo arranca con el contador de folios en cero", async ({ scenario }) => {
    expect(scenario.type.counter).toBe(0);
    expect(scenario.type.active).toBe(true);
  });

  test("da de alta 15 unidades disponibles con folio consecutivo", async ({ inv, scenario }) => {
    const samsung = await scenario.device(15, { name: `Samsung A9 ${scenario.type.code}` });

    const stock = await inv.stock(samsung.id);
    expect(stock).toMatchObject({
      AVAILABLE: 15,
      ON_LOAN: 0,
      DAMAGED: 0,
      IN_MAINTENANCE: 0,
      RETIREMENT: 0,
      active: 15,
      historical: 15,
    });

    const units = await inv.units(samsung.id);
    expect(units).toHaveLength(15);
    expect(units.every((u) => u.status === "AVAILABLE")).toBe(true);
    expect(units[0].assetTag).toBe(`${scenario.type.assetTagPrefix}-0001`);
    expect(units[14].assetTag).toBe(`${scenario.type.assetTagPrefix}-0015`);

    // El contador del tipo avanzó para que el siguiente folio no se repita.
    const type = await inv.type(scenario.type.id);
    expect(type.counter).toBe(15);
  });

  test("el alta queda respaldada por un movimiento de ENTRADA", async ({ inv, scenario }) => {
    const device = await scenario.device(15);

    const movements = await inv.listMovements({ deviceId: device.id });
    expect(movements).toHaveLength(1);
    expect(movements[0]).toMatchObject({ type: "STOCK_IN", reason: "Alta inicial", status: "ACTIVE" });
    expect(movements[0].items[0]).toMatchObject({ deviceId: device.id, quantity: 15 });
  });

  test("el kardex arranca con el saldo del alta", async ({ inv, scenario }) => {
    const device = await scenario.device(15);

    const stockLedger = await inv.stockLedger(device.id);
    expect(stockLedger.rows).toHaveLength(1);
    expect(stockLedger.rows[0]).toMatchObject({ type: "STOCK_IN", stockIn: 15, stockOut: 0, balance: 15 });
  });

  test("el alta con unidades identificadas guarda serie, MAC, IP y nombre de equipo", async ({
    inv,
    scenario,
  }) => {
    const brand = scenario.type.code;
    const device = await inv.createDevice({
      typeId: scenario.type.id,
      name: `Laptop identificada ${brand}`,
      brand: "Dell",
      model: "Latitude 5440",
      units: [
        { serialNumber: `SN-${brand}-1`, macAddress: `02:00:00:${brand.slice(-2)}:00:01`, ip: "10.0.0.11", hostname: `PC-${brand}-1` },
        { serialNumber: `SN-${brand}-2`, macAddress: `02:00:00:${brand.slice(-2)}:00:02`, ip: "10.0.0.12", hostname: `PC-${brand}-2` },
      ],
    });

    const units = await inv.units(device.id);
    expect(units).toHaveLength(2);
    expect(units[0]).toMatchObject({
      serialNumber: `SN-${brand}-1`,
      ip: "10.0.0.11",
      hostname: `PC-${brand}-1`,
      status: "AVAILABLE",
    });
    expect(await inv.stock(device.id)).toMatchObject({ AVAILABLE: 2, active: 2 });
  });

  test("dos dispositivos del mismo tipo continúan el folio pero no comparten existencias", async ({
    inv,
    scenario,
  }) => {
    const samsung = await scenario.device(15, { name: `Samsung A9 ${scenario.type.code}` });
    const ipad = await scenario.device(50, { name: `iPad Pro ${scenario.type.code}` });

    expect(await inv.stock(samsung.id)).toMatchObject({ AVAILABLE: 15, active: 15 });
    expect(await inv.stock(ipad.id)).toMatchObject({ AVAILABLE: 50, active: 50 });

    // El folio es del tipo, así que el segundo dispositivo sigue donde quedó el primero.
    const unitsIpad = await inv.units(ipad.id);
    expect(unitsIpad[0].assetTag).toBe(`${scenario.type.assetTagPrefix}-0016`);
    expect(unitsIpad[49].assetTag).toBe(`${scenario.type.assetTagPrefix}-0065`);
    expect(await inv.type(scenario.type.id)).toMatchObject({ counter: 65 });
  });

  test("las existencias leídas por la API coinciden con lo que hay en la base", async ({
    inv,
    scenario,
  }) => {
    const device = await scenario.device(7);

    expect(await statusesInDb(device.id)).toEqual({ AVAILABLE: 7 });
    expect(await db.deviceUnit.count({ where: { deviceId: device.id } })).toBe(7);
    expect(await inv.stock(device.id)).toMatchObject({ AVAILABLE: 7 });
  });

  test.describe("validaciones", () => {
    test("rechaza cantidad inicial fuera de rango", async ({ inv, scenario }) => {
      const zero = await inv.post("/inventory/devices", {
        typeId: scenario.type.id,
        name: "Cantidad cero",
        brand: "M",
        model: "X",
        initialQuantity: 0,
      });
      expect(zero.status).toBe(400);
      expect(zero.body).toMatchObject({ error: "ValidationError" });

      const excessive = await inv.post("/inventory/devices", {
        typeId: scenario.type.id,
        name: "Cantidad excesiva",
        brand: "M",
        model: "X",
        initialQuantity: 5001,
      });
      expect(excessive.status).toBe(400);
      expect(excessive.body).toMatchObject({ error: "ValidationError" });
    });

    test("rechaza el alta sin nombre", async ({ inv, scenario }) => {
      const res = await inv.post("/inventory/devices", {
        typeId: scenario.type.id,
        brand: "M",
        model: "X",
        initialQuantity: 1,
      });
      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ error: "ValidationError" });
    });

    test("rechaza el alta con un tipo inexistente", async ({ inv }) => {
      const res = await inv.post("/inventory/devices", {
        typeId: "00000000-0000-0000-0000-000000000000",
        name: "Sin tipo",
        brand: "M",
        model: "X",
        initialQuantity: 1,
      });
      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ message: "Tipo de dispositivo inválido" });
    });

    test("rechaza el alta con un tipo inactivo", async ({ inv, scenario }) => {
      await inv.put(`/inventory/device-types/${scenario.type.id}`, { active: false });

      const res = await inv.post("/inventory/devices", {
        typeId: scenario.type.id,
        name: "Tipo apagado",
        brand: "M",
        model: "X",
        initialQuantity: 1,
      });
      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ message: "Tipo de dispositivo inválido" });
    });

    test("rechaza dos dispositivos idénticos dentro del mismo tipo", async ({ inv, scenario }) => {
      const payload = {
        typeId: scenario.type.id,
        name: `Duplicado ${scenario.type.code}`,
        brand: "M",
        model: "X",
        initialQuantity: 1,
      };
      await inv.createDevice(payload);

      const res = await inv.post("/inventory/devices", payload);
      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({ error: "PrismaError" });
    });

    test("no deja borrar un tipo que ya tiene dispositivos", async ({ inv, scenario }) => {
      await scenario.device(1);

      const res = await inv.from(`/inventory/device-types/${scenario.type.id}`);
      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({ message: "El tipo tiene dispositivos; no se puede eliminar" });
      expect(await inv.type(scenario.type.id)).toMatchObject({ id: scenario.type.id });
    });

    test("no deja borrar un dispositivo que ya tiene unidades", async ({ inv, scenario }) => {
      const device = await scenario.device(3);

      const res = await inv.from(`/inventory/devices/${device.id}`);
      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({ message: "El dispositivo tiene unidades; no se puede eliminar" });
      expect(await inv.stock(device.id)).toMatchObject({ AVAILABLE: 3 });
    });
  });

  test.describe("autorización", () => {
    test("un EMPLEADO no puede dar de alta tipos ni dispositivos", async ({ invEmployee, scenario }) => {
      const type = await invEmployee.post("/inventory/device-types", {
        code: "NOPE",
        name: "Nope",
        assetTagPrefix: "NOPE",
      });
      expect(type.status).toBe(403);

      const device = await invEmployee.post("/inventory/devices", {
        typeId: scenario.type.id,
        name: "No permitido",
        brand: "M",
        model: "X",
        initialQuantity: 1,
      });
      expect(device.status).toBe(403);
      expect(device.body).toMatchObject({ message: "Permisos insuficientes" });
    });

    test("sin token no se puede ni leer el catálogo", async ({ invAnonymous }) => {
      const res = await invAnonymous.get("/inventory/device-types");
      expect(res.status).toBe(401);
    });
  });
});
