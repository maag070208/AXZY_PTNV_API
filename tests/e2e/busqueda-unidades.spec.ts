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
    escenario,
  }) => {
    const dispositivo = await escenario.dispositivo(3, {
      nombre: `Laptop ${escenario.tipo.code}`,
      marca: "Dell",
      modelo: "Latitude 5440",
    });
    const folio = `${escenario.tipo.folioPrefix}-0002`;

    const encontradas = await inv.buscarUnidades(folio);

    expect(encontradas).toHaveLength(1);
    expect(encontradas[0]).toMatchObject({
      activoFijo: folio,
      estado: "DISPONIBLE",
      dispositivoId: dispositivo.id,
    });
    // El catálogo viene resuelto: la app pinta el equipo sin una segunda llamada.
    expect(encontradas[0].dispositivo).toMatchObject({
      id: dispositivo.id,
      marca: "Dell",
      modelo: "Latitude 5440",
    });
    expect(encontradas[0].dispositivo.tipo).toMatchObject({
      id: escenario.tipo.id,
      folioPrefix: escenario.tipo.folioPrefix,
    });
  });

  test("el prefijo del tipo devuelve todas sus unidades, ordenadas por folio", async ({
    inv,
    escenario,
  }) => {
    await escenario.dispositivo(3);

    const encontradas = await inv.buscarUnidades(escenario.tipo.folioPrefix);

    expect(encontradas.map((u) => u.activoFijo)).toEqual([
      `${escenario.tipo.folioPrefix}-0001`,
      `${escenario.tipo.folioPrefix}-0002`,
      `${escenario.tipo.folioPrefix}-0003`,
    ]);
  });

  test("busca también por número de serie y por nombre de equipo", async ({ inv, escenario }) => {
    const marca = escenario.tipo.code;
    await inv.crearDispositivo({
      tipoId: escenario.tipo.id,
      nombre: `Laptop identificada ${marca}`,
      marca: "Dell",
      modelo: "Latitude 5440",
      unidades: [{ numeroSerie: `SN-${marca}-1`, nombreEquipo: `PC-${marca}-1` }],
    });

    const porSerie = await inv.buscarUnidades(`SN-${marca}-1`);
    expect(porSerie).toHaveLength(1);
    expect(porSerie[0].numeroSerie).toBe(`SN-${marca}-1`);

    const porEquipo = await inv.buscarUnidades(`PC-${marca}-1`);
    expect(porEquipo.map((u) => u.id)).toEqual([porSerie[0].id]);
  });

  test("ignora mayúsculas y minúsculas", async ({ inv, escenario }) => {
    await escenario.dispositivo(1);
    const folio = `${escenario.tipo.folioPrefix}-0001`;

    const encontradas = await inv.buscarUnidades(folio.toLowerCase());

    expect(encontradas.map((u) => u.activoFijo)).toEqual([folio]);
  });

  test("respeta el límite y nunca pasa de 50", async ({ inv, escenario }) => {
    await escenario.dispositivo(3);

    expect(await inv.buscarUnidades(escenario.tipo.folioPrefix, 2)).toHaveLength(2);
    // Un límite absurdo se recorta al tope, no revienta ni pagina de más.
    expect(await inv.buscarUnidades(escenario.tipo.folioPrefix, 9999)).toHaveLength(3);
  });

  test("una búsqueda vacía no devuelve el inventario completo", async ({ inv }) => {
    expect(await inv.buscarUnidades("")).toEqual([]);
    expect(await inv.buscarUnidades("   ")).toEqual([]);
  });

  test("sin resultados devuelve una lista vacía, no un error", async ({ inv, escenario }) => {
    await escenario.dispositivo(1);

    expect(await inv.buscarUnidades(`${escenario.tipo.folioPrefix}-NO-EXISTE`)).toEqual([]);
  });

  test("un EMPLEADO puede consultar, pero sin token responde 401", async ({
    inv,
    invEmpleado,
    invAnonimo,
    escenario,
  }) => {
    await escenario.dispositivo(1);
    const folio = `${escenario.tipo.folioPrefix}-0001`;

    // Consultar inventario no está restringido por rol; lo que exige rol es moverlo.
    expect((await invEmpleado.buscarUnidades(folio)).map((u) => u.activoFijo)).toEqual([folio]);

    const anonimo = await invAnonimo.get(`/inventario/unidades?q=${folio}`);
    expect(anonimo.status).toBe(401);

    expect(await inv.buscarUnidades(folio)).toHaveLength(1);
  });
});
