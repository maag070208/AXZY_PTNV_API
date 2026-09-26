import { test, expect } from "./support/fixtures";

/**
 * Búsqueda de unidades — `GET /inventario/unidades?q=`.
 *
 * Es el punto de entrada de la app móvil: en la web se llega al equipo
 * navegando el catálogo (tipo → dispositivo → unidades), pero en campo se
 * teclea o escanea lo que trae impreso el equipo. Por eso la búsqueda pega
 * contra activo fijo, número de serie y nombre de equipo, y devuelve la unidad
 * con su dispositivo y tipo ya resueltos, para no encadenar llamadas.
 */
test.describe("Búsqueda de unidades por activo fijo", () => {
  test("encuentra la unidad por su activo fijo exacto y trae el catálogo resuelto", async ({
    inv,
    scenario,
  }) => {
    const device = await scenario.device(3, {
      name: `Laptop ${scenario.type.code}`,
      brand: "Dell",
      model: "Latitude 5440",
    });
    const folio = `${scenario.type.assetTagPrefix}-0002`;

    const found = await inv.searchUnits(folio);

    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      assetTag: folio,
      status: "AVAILABLE",
      deviceId: device.id,
    });
    // El catálogo viene resuelto: la app pinta el equipo sin una segunda llamada.
    expect(found[0].device).toMatchObject({
      id: device.id,
      brand: "Dell",
      model: "Latitude 5440",
    });
    expect(found[0].device.type).toMatchObject({
      id: scenario.type.id,
      assetTagPrefix: scenario.type.assetTagPrefix,
    });
  });

  test("el prefijo del tipo devuelve todas sus unidades, ordenadas por folio", async ({
    inv,
    scenario,
  }) => {
    await scenario.device(3);

    const found = await inv.searchUnits(scenario.type.assetTagPrefix);

    expect(found.map((u) => u.assetTag)).toEqual([
      `${scenario.type.assetTagPrefix}-0001`,
      `${scenario.type.assetTagPrefix}-0002`,
      `${scenario.type.assetTagPrefix}-0003`,
    ]);
  });

  test("busca también por número de serie y por nombre de equipo", async ({ inv, scenario }) => {
    const brand = scenario.type.code;
    await inv.createDevice({
      typeId: scenario.type.id,
      name: `Laptop identificada ${brand}`,
      brand: "Dell",
      model: "Latitude 5440",
      units: [{ serialNumber: `SN-${brand}-1`, hostname: `PC-${brand}-1` }],
    });

    const bySerial = await inv.searchUnits(`SN-${brand}-1`);
    expect(bySerial).toHaveLength(1);
    expect(bySerial[0].serialNumber).toBe(`SN-${brand}-1`);

    const byHostname = await inv.searchUnits(`PC-${brand}-1`);
    expect(byHostname.map((u) => u.id)).toEqual([bySerial[0].id]);
  });

  test("ignora mayúsculas y minúsculas", async ({ inv, scenario }) => {
    await scenario.device(1);
    const folio = `${scenario.type.assetTagPrefix}-0001`;

    const found = await inv.searchUnits(folio.toLowerCase());

    expect(found.map((u) => u.assetTag)).toEqual([folio]);
  });

  test("respeta el límite y nunca pasa de 50", async ({ inv, scenario }) => {
    await scenario.device(3);

    expect(await inv.searchUnits(scenario.type.assetTagPrefix, 2)).toHaveLength(2);
    // Un límite absurdo se recorta al tope, no revienta ni pagina de más.
    expect(await inv.searchUnits(scenario.type.assetTagPrefix, 9999)).toHaveLength(3);
  });

  test("una búsqueda vacía no devuelve el inventario completo", async ({ inv }) => {
    expect(await inv.searchUnits("")).toEqual([]);
    expect(await inv.searchUnits("   ")).toEqual([]);
  });

  test("sin resultados devuelve una lista vacía, no un error", async ({ inv, scenario }) => {
    await scenario.device(1);

    expect(await inv.searchUnits(`${scenario.type.assetTagPrefix}-NO-EXISTE`)).toEqual([]);
  });

  test("un EMPLEADO puede consultar, pero sin token responde 401", async ({
    inv,
    invEmployee,
    invAnonymous,
    scenario,
  }) => {
    await scenario.device(1);
    const folio = `${scenario.type.assetTagPrefix}-0001`;

    // Consultar inventario no está restringido por rol; lo que exige rol es moverlo.
    expect((await invEmployee.searchUnits(folio)).map((u) => u.assetTag)).toEqual([folio]);

    const anonymous = await invAnonymous.get(`/inventory/units?q=${folio}`);
    expect(anonymous.status).toBe(401);

    expect(await inv.searchUnits(folio)).toHaveLength(1);
  });
});
