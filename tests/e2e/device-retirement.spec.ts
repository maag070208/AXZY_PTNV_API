import { test, expect } from "./support/fixtures";
import { estadosEnBase } from "./support/db";

/**
 * Flujo BAJA — DISPOSITIVOS.md §15 a §17, §24 y §26.
 *
 * La baja retira unidades del inventario operativo. Siempre es un movimiento
 * con motivo, nunca una edición directa de cantidades, y sólo puede tomar
 * unidades que estén disponibles.
 */
test.describe("BAJA de inventario", () => {
  test("da de baja 2 unidades y las saca de la existencia activa", async ({ inv, escenario }) => {
    const dispositivo = await escenario.dispositivo(15);

    const movimiento = await inv.darDeBaja(dispositivo.id, 2, "Daño irreparable");

    expect(movimiento).toMatchObject({ tipo: "BAJA", motivo: "Daño irreparable", status: "ACTIVO" });
    expect(movimiento.detalles[0]).toMatchObject({ dispositivoId: dispositivo.id, cantidad: 2 });

    // La baja sale de la existencia activa pero permanece en la histórica (§26).
    expect(await inv.existencias(dispositivo.id)).toMatchObject({
      DISPONIBLE: 13,
      BAJA: 2,
      activa: 13,
      historica: 15,
    });
    expect(await estadosEnBase(dispositivo.id)).toEqual({ DISPONIBLE: 13, BAJA: 2 });
  });

  test("exige motivo", async ({ inv, escenario }) => {
    const dispositivo = await escenario.dispositivo(5);

    const res = await inv.post("/inventario/movimientos", {
      tipo: "BAJA",
      detalles: [{ dispositivoId: dispositivo.id, cantidad: 1 }],
    });

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ message: "Motivo requerido para la baja" });
    expect(await inv.existencias(dispositivo.id)).toMatchObject({ DISPONIBLE: 5, BAJA: 0 });
  });

  test("exige al menos un detalle", async ({ inv }) => {
    const res = await inv.post("/inventario/movimientos", {
      tipo: "BAJA",
      motivo: "Sin detalles",
      detalles: [],
    });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ message: "Agrega al menos un detalle" });
  });

  test("no deja dar de baja más de lo disponible", async ({ inv, escenario }) => {
    const dispositivo = await escenario.dispositivo(5);

    const res = await inv.post("/inventario/movimientos", {
      tipo: "BAJA",
      motivo: "Intento excesivo",
      detalles: [{ dispositivoId: dispositivo.id, cantidad: 8 }],
    });

    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({
      message: expect.stringContaining("se requieren 8, hay 5"),
    });
    expect(await inv.existencias(dispositivo.id)).toMatchObject({ DISPONIBLE: 5, BAJA: 0 });
  });

  test("las unidades prestadas no se pueden dar de baja (§17)", async ({
    inv,
    escenario,
    departamentoId,
  }) => {
    const dispositivo = await escenario.dispositivo(15);
    await inv.prestar({
      departamentoId,
      detalles: [{ dispositivoId: dispositivo.id, cantidad: 10 }],
    });
    expect(await inv.existencias(dispositivo.id)).toMatchObject({ DISPONIBLE: 5, PRESTADO: 10 });

    // 8 > las 5 disponibles: aunque existan 15 piezas, las prestadas no cuentan.
    const excedido = await inv.post("/inventario/movimientos", {
      tipo: "BAJA",
      motivo: "Intento sobre prestadas",
      detalles: [{ dispositivoId: dispositivo.id, cantidad: 8 }],
    });
    expect(excedido.status).toBe(409);
    expect(await inv.existencias(dispositivo.id)).toMatchObject({ DISPONIBLE: 5, PRESTADO: 10, BAJA: 0 });

    // El máximo permitido sí pasa.
    await inv.darDeBaja(dispositivo.id, 5, "Obsoletas");
    expect(await inv.existencias(dispositivo.id)).toMatchObject({
      DISPONIBLE: 0,
      PRESTADO: 10,
      BAJA: 5,
      activa: 10,
      historica: 15,
    });
  });

  test("no deja dar de baja una unidad prestada aunque se indique por id", async ({
    inv,
    escenario,
    departamentoId,
  }) => {
    const dispositivo = await escenario.dispositivo(4);
    await inv.prestar({ departamentoId, detalles: [{ dispositivoId: dispositivo.id, cantidad: 2 }] });
    const prestada = (await inv.unidades(dispositivo.id)).find((u) => u.estado === "PRESTADO")!;

    const res = await inv.post("/inventario/movimientos", {
      tipo: "BAJA",
      motivo: "Intento directo",
      detalles: [{ dispositivoId: dispositivo.id, cantidad: 1, unidadId: prestada.id }],
    });

    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({
      message: `La unidad ${prestada.activoFijo} está en estado PRESTADO; se esperaba DISPONIBLE`,
    });
    expect(await inv.existencias(dispositivo.id)).toMatchObject({ PRESTADO: 2, BAJA: 0 });
  });

  test("da de baja exactamente la unidad indicada", async ({ inv, escenario }) => {
    const dispositivo = await escenario.dispositivo(5);
    const elegida = (await inv.unidades(dispositivo.id))[4];

    await inv.darDeBaja(dispositivo.id, 1, "Robo", elegida.id);

    const despues = await inv.unidades(dispositivo.id);
    expect(despues.find((u) => u.id === elegida.id)?.estado).toBe("BAJA");
    expect(despues.filter((u) => u.estado === "BAJA")).toHaveLength(1);
  });

  test("una baja con varios dispositivos valida cada detalle por separado", async ({
    inv,
    escenario,
  }) => {
    const samsung = await escenario.dispositivo(13);
    const ipad = await escenario.dispositivo(20);

    const movimiento = await inv.movimiento({
      tipo: "BAJA",
      motivo: "Retiro de lote",
      detalles: [
        { dispositivoId: samsung.id, cantidad: 5 },
        { dispositivoId: ipad.id, cantidad: 10 },
      ],
    });

    expect(movimiento.detalles).toHaveLength(2);
    expect(await inv.existencias(samsung.id)).toMatchObject({ DISPONIBLE: 8, BAJA: 5 });
    expect(await inv.existencias(ipad.id)).toMatchObject({ DISPONIBLE: 10, BAJA: 10 });
  });

  test("si un detalle no alcanza, no se da de baja ninguno", async ({ inv, escenario }) => {
    const suficiente = await escenario.dispositivo(10);
    const escaso = await escenario.dispositivo(2);

    const res = await inv.post("/inventario/movimientos", {
      tipo: "BAJA",
      motivo: "Lote mixto",
      detalles: [
        { dispositivoId: suficiente.id, cantidad: 3 },
        { dispositivoId: escaso.id, cantidad: 7 },
      ],
    });

    expect(res.status).toBe(409);
    expect(await inv.existencias(suficiente.id)).toMatchObject({ DISPONIBLE: 10, BAJA: 0 });
    expect(await inv.existencias(escaso.id)).toMatchObject({ DISPONIBLE: 2, BAJA: 0 });
  });

  test("una unidad dada de baja ya no se puede prestar", async ({
    inv,
    escenario,
    departamentoId,
  }) => {
    const dispositivo = await escenario.dispositivo(3);
    await inv.darDeBaja(dispositivo.id, 3, "Fin de vida útil");

    const res = await inv.post("/inventario/prestamos", {
      departamentoId,
      detalles: [{ dispositivoId: dispositivo.id, cantidad: 1 }],
    });

    expect(res.status).toBe(409);
    expect(await inv.existencias(dispositivo.id)).toMatchObject({
      DISPONIBLE: 0,
      BAJA: 3,
      activa: 0,
      historica: 3,
    });
  });

  test("la baja queda en el histórico y en el kardex, nunca se borra", async ({
    inv,
    escenario,
  }) => {
    const dispositivo = await escenario.dispositivo(10);
    await inv.darDeBaja(dispositivo.id, 4, "Daño por agua");

    const movimientos = await inv.listarMovimientos({ dispositivoId: dispositivo.id, tipo: "BAJA" });
    expect(movimientos).toHaveLength(1);
    expect(movimientos[0]).toMatchObject({ motivo: "Daño por agua", status: "ACTIVO" });

    const kardex = await inv.kardex(dispositivo.id);
    expect(kardex.rows.map((r) => [r.tipo, r.entrada, r.salida, r.saldo])).toEqual([
      ["ENTRADA", 10, 0, 10],
      ["BAJA", 0, 4, 6],
    ]);
  });

  test("la baja de una unidad dañada pasa por mantenimiento", async ({ inv, escenario }) => {
    // Una unidad DANADO no es DISPONIBLE, así que la baja directa no la alcanza:
    // el camino es mantenimiento → salida ROTO, que sí la da de baja.
    const dispositivo = await escenario.dispositivo(4);
    await inv.enviarAMantenimiento(dispositivo.id, 2);
    await inv.sacarDeMantenimiento(dispositivo.id, 2, "MALO");
    expect(await inv.existencias(dispositivo.id)).toMatchObject({ DISPONIBLE: 2, DANADO: 2 });

    const directa = await inv.post("/inventario/movimientos", {
      tipo: "BAJA",
      motivo: "Intento sobre dañadas",
      detalles: [{ dispositivoId: dispositivo.id, cantidad: 3 }],
    });
    expect(directa.status).toBe(409);

    await inv.darDeBaja(dispositivo.id, 2, "Retiro de las sanas");
    expect(await inv.existencias(dispositivo.id)).toMatchObject({
      DISPONIBLE: 0,
      DANADO: 2,
      BAJA: 2,
      activa: 2,
      historica: 4,
    });
  });

  test("un EMPLEADO no puede dar de baja", async ({ invEmpleado, escenario, inv }) => {
    const dispositivo = await escenario.dispositivo(3);

    const res = await invEmpleado.post("/inventario/movimientos", {
      tipo: "BAJA",
      motivo: "No autorizado",
      detalles: [{ dispositivoId: dispositivo.id, cantidad: 1 }],
    });

    expect(res.status).toBe(403);
    expect(await inv.existencias(dispositivo.id)).toMatchObject({ DISPONIBLE: 3, BAJA: 0 });
  });
});
