import { test, expect } from "./support/fixtures";
import { db, estadosEnBase } from "./support/db";

/**
 * Flujo ALTA — DISPOSITIVOS.md §4, §5, §18.
 *
 * El alta entra por `POST /inventario/dispositivos`: crea el dispositivo, una
 * unidad física por cada pieza (con su folio de activo fijo) y el movimiento de
 * ENTRADA que respalda las existencias.
 */
test.describe("ALTA de inventario", () => {
  test("el alta de un tipo arranca con el contador de folios en cero", async ({ escenario }) => {
    expect(escenario.tipo.contador).toBe(0);
    expect(escenario.tipo.active).toBe(true);
  });

  test("da de alta 15 unidades disponibles con folio consecutivo", async ({ inv, escenario }) => {
    const samsung = await escenario.dispositivo(15, { nombre: `Samsung A9 ${escenario.tipo.code}` });

    const existencias = await inv.existencias(samsung.id);
    expect(existencias).toMatchObject({
      DISPONIBLE: 15,
      PRESTADO: 0,
      DANADO: 0,
      MANTENIMIENTO: 0,
      BAJA: 0,
      activa: 15,
      historica: 15,
    });

    const unidades = await inv.unidades(samsung.id);
    expect(unidades).toHaveLength(15);
    expect(unidades.every((u) => u.estado === "DISPONIBLE")).toBe(true);
    expect(unidades[0].activoFijo).toBe(`${escenario.tipo.folioPrefix}-0001`);
    expect(unidades[14].activoFijo).toBe(`${escenario.tipo.folioPrefix}-0015`);

    // El contador del tipo avanzó para que el siguiente folio no se repita.
    const tipo = await inv.tipo(escenario.tipo.id);
    expect(tipo.contador).toBe(15);
  });

  test("el alta queda respaldada por un movimiento de ENTRADA", async ({ inv, escenario }) => {
    const dispositivo = await escenario.dispositivo(15);

    const movimientos = await inv.listarMovimientos({ dispositivoId: dispositivo.id });
    expect(movimientos).toHaveLength(1);
    expect(movimientos[0]).toMatchObject({ tipo: "ENTRADA", motivo: "Alta inicial", status: "ACTIVO" });
    expect(movimientos[0].detalles[0]).toMatchObject({ dispositivoId: dispositivo.id, cantidad: 15 });
  });

  test("el kardex arranca con el saldo del alta", async ({ inv, escenario }) => {
    const dispositivo = await escenario.dispositivo(15);

    const kardex = await inv.kardex(dispositivo.id);
    expect(kardex.rows).toHaveLength(1);
    expect(kardex.rows[0]).toMatchObject({ tipo: "ENTRADA", entrada: 15, salida: 0, saldo: 15 });
  });

  test("el alta con unidades identificadas guarda serie, MAC, IP y nombre de equipo", async ({
    inv,
    escenario,
  }) => {
    const marca = escenario.tipo.code;
    const dispositivo = await inv.crearDispositivo({
      tipoId: escenario.tipo.id,
      nombre: `Laptop identificada ${marca}`,
      marca: "Dell",
      modelo: "Latitude 5440",
      unidades: [
        { numeroSerie: `SN-${marca}-1`, macAddress: `02:00:00:${marca.slice(-2)}:00:01`, ip: "10.0.0.11", nombreEquipo: `PC-${marca}-1` },
        { numeroSerie: `SN-${marca}-2`, macAddress: `02:00:00:${marca.slice(-2)}:00:02`, ip: "10.0.0.12", nombreEquipo: `PC-${marca}-2` },
      ],
    });

    const unidades = await inv.unidades(dispositivo.id);
    expect(unidades).toHaveLength(2);
    expect(unidades[0]).toMatchObject({
      numeroSerie: `SN-${marca}-1`,
      ip: "10.0.0.11",
      nombreEquipo: `PC-${marca}-1`,
      estado: "DISPONIBLE",
    });
    expect(await inv.existencias(dispositivo.id)).toMatchObject({ DISPONIBLE: 2, activa: 2 });
  });

  test("dos dispositivos del mismo tipo continúan el folio pero no comparten existencias", async ({
    inv,
    escenario,
  }) => {
    const samsung = await escenario.dispositivo(15, { nombre: `Samsung A9 ${escenario.tipo.code}` });
    const ipad = await escenario.dispositivo(50, { nombre: `iPad Pro ${escenario.tipo.code}` });

    expect(await inv.existencias(samsung.id)).toMatchObject({ DISPONIBLE: 15, activa: 15 });
    expect(await inv.existencias(ipad.id)).toMatchObject({ DISPONIBLE: 50, activa: 50 });

    // El folio es del tipo, así que el segundo dispositivo sigue donde quedó el primero.
    const unidadesIpad = await inv.unidades(ipad.id);
    expect(unidadesIpad[0].activoFijo).toBe(`${escenario.tipo.folioPrefix}-0016`);
    expect(unidadesIpad[49].activoFijo).toBe(`${escenario.tipo.folioPrefix}-0065`);
    expect(await inv.tipo(escenario.tipo.id)).toMatchObject({ contador: 65 });
  });

  test("las existencias leídas por la API coinciden con lo que hay en la base", async ({
    inv,
    escenario,
  }) => {
    const dispositivo = await escenario.dispositivo(7);

    expect(await estadosEnBase(dispositivo.id)).toEqual({ DISPONIBLE: 7 });
    expect(await db.unidadFisica.count({ where: { dispositivoId: dispositivo.id } })).toBe(7);
    expect(await inv.existencias(dispositivo.id)).toMatchObject({ DISPONIBLE: 7 });
  });

  test.describe("validaciones", () => {
    test("rechaza cantidad inicial fuera de rango", async ({ inv, escenario }) => {
      const cero = await inv.post("/inventario/dispositivos", {
        tipoId: escenario.tipo.id,
        nombre: "Cantidad cero",
        marca: "M",
        modelo: "X",
        cantidadInicial: 0,
      });
      expect(cero.status).toBe(400);
      expect(cero.body).toMatchObject({ error: "ValidationError" });

      const excesiva = await inv.post("/inventario/dispositivos", {
        tipoId: escenario.tipo.id,
        nombre: "Cantidad excesiva",
        marca: "M",
        modelo: "X",
        cantidadInicial: 5001,
      });
      expect(excesiva.status).toBe(400);
      expect(excesiva.body).toMatchObject({ error: "ValidationError" });
    });

    test("rechaza el alta sin nombre", async ({ inv, escenario }) => {
      const res = await inv.post("/inventario/dispositivos", {
        tipoId: escenario.tipo.id,
        marca: "M",
        modelo: "X",
        cantidadInicial: 1,
      });
      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ error: "ValidationError" });
    });

    test("rechaza el alta con un tipo inexistente", async ({ inv }) => {
      const res = await inv.post("/inventario/dispositivos", {
        tipoId: "00000000-0000-0000-0000-000000000000",
        nombre: "Sin tipo",
        marca: "M",
        modelo: "X",
        cantidadInicial: 1,
      });
      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ message: "Tipo de dispositivo inválido" });
    });

    test("rechaza el alta con un tipo inactivo", async ({ inv, escenario }) => {
      await inv.put(`/inventario/tipos/${escenario.tipo.id}`, { active: false });

      const res = await inv.post("/inventario/dispositivos", {
        tipoId: escenario.tipo.id,
        nombre: "Tipo apagado",
        marca: "M",
        modelo: "X",
        cantidadInicial: 1,
      });
      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ message: "Tipo de dispositivo inválido" });
    });

    test("rechaza dos dispositivos idénticos dentro del mismo tipo", async ({ inv, escenario }) => {
      const payload = {
        tipoId: escenario.tipo.id,
        nombre: `Duplicado ${escenario.tipo.code}`,
        marca: "M",
        modelo: "X",
        cantidadInicial: 1,
      };
      await inv.crearDispositivo(payload);

      const res = await inv.post("/inventario/dispositivos", payload);
      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({ error: "PrismaError" });
    });

    test("no deja borrar un tipo que ya tiene dispositivos", async ({ inv, escenario }) => {
      await escenario.dispositivo(1);

      const res = await inv.del(`/inventario/tipos/${escenario.tipo.id}`);
      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({ message: "El tipo tiene dispositivos; no se puede eliminar" });
      expect(await inv.tipo(escenario.tipo.id)).toMatchObject({ id: escenario.tipo.id });
    });

    test("no deja borrar un dispositivo que ya tiene unidades", async ({ inv, escenario }) => {
      const dispositivo = await escenario.dispositivo(3);

      const res = await inv.del(`/inventario/dispositivos/${dispositivo.id}`);
      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({ message: "El dispositivo tiene unidades; no se puede eliminar" });
      expect(await inv.existencias(dispositivo.id)).toMatchObject({ DISPONIBLE: 3 });
    });
  });

  test.describe("autorización", () => {
    test("un EMPLEADO no puede dar de alta tipos ni dispositivos", async ({ invEmpleado, escenario }) => {
      const tipo = await invEmpleado.post("/inventario/tipos", {
        code: "NOPE",
        name: "Nope",
        folioPrefix: "NOPE",
      });
      expect(tipo.status).toBe(403);

      const dispositivo = await invEmpleado.post("/inventario/dispositivos", {
        tipoId: escenario.tipo.id,
        nombre: "No permitido",
        marca: "M",
        modelo: "X",
        cantidadInicial: 1,
      });
      expect(dispositivo.status).toBe(403);
      expect(dispositivo.body).toMatchObject({ message: "Permisos insuficientes" });
    });

    test("sin token no se puede ni leer el catálogo", async ({ invAnonimo }) => {
      const res = await invAnonimo.get("/inventario/tipos");
      expect(res.status).toBe(401);
    });
  });
});
