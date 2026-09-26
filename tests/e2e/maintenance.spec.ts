import { test, expect } from "./support/fixtures";
import { db, estadosEnBase } from "./support/db";

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
    escenario,
  }) => {
    const dispositivo = await escenario.dispositivo(10);

    const movimiento = await inv.enviarAMantenimiento(dispositivo.id, 3, "Revisión preventiva");

    expect(movimiento).toMatchObject({
      tipo: "MANTENIMIENTO_ENTRADA",
      motivo: "Revisión preventiva",
      status: "ACTIVO",
    });
    expect(await inv.existencias(dispositivo.id)).toMatchObject({
      DISPONIBLE: 7,
      MANTENIMIENTO: 3,
      activa: 10,
      historica: 10,
    });
    expect(await estadosEnBase(dispositivo.id)).toEqual({ DISPONIBLE: 7, MANTENIMIENTO: 3 });
  });

  test("la salida en buen estado regresa las unidades a disponibles", async ({ inv, escenario }) => {
    const dispositivo = await escenario.dispositivo(10);
    await inv.enviarAMantenimiento(dispositivo.id, 4);

    await inv.sacarDeMantenimiento(dispositivo.id, 2, "BUENO");
    expect(await inv.existencias(dispositivo.id)).toMatchObject({ DISPONIBLE: 8, MANTENIMIENTO: 2 });

    await inv.sacarDeMantenimiento(dispositivo.id, 2, "ACEPTABLE");
    expect(await inv.existencias(dispositivo.id)).toMatchObject({
      DISPONIBLE: 10,
      MANTENIMIENTO: 0,
      activa: 10,
    });
  });

  test("la salida en mal estado deja la unidad como dañada", async ({ inv, escenario }) => {
    const dispositivo = await escenario.dispositivo(6);
    await inv.enviarAMantenimiento(dispositivo.id, 3);

    await inv.sacarDeMantenimiento(dispositivo.id, 2, "MALO");

    expect(await inv.existencias(dispositivo.id)).toMatchObject({
      DISPONIBLE: 3,
      MANTENIMIENTO: 1,
      DANADO: 2,
      activa: 6,
      historica: 6,
    });
  });

  test("la salida como ROTO da de baja la unidad y registra el movimiento automático", async ({
    inv,
    escenario,
  }) => {
    const dispositivo = await escenario.dispositivo(6);
    await inv.enviarAMantenimiento(dispositivo.id, 3);

    await inv.movimiento({
      tipo: "MANTENIMIENTO_SALIDA",
      detalles: [
        {
          dispositivoId: dispositivo.id,
          cantidad: 2,
          condicion: "ROTO",
          observaciones: "Sin refacciones",
        },
      ],
    });

    expect(await inv.existencias(dispositivo.id)).toMatchObject({
      DISPONIBLE: 3,
      MANTENIMIENTO: 1,
      BAJA: 2,
      activa: 4,
      historica: 6,
    });

    const bajas = await inv.listarMovimientos({ dispositivoId: dispositivo.id, tipo: "BAJA" });
    expect(bajas).toHaveLength(1);
    expect(bajas[0].motivo).toBe("Baja automática por estado ROTO");
  });

  test("la salida sin condición asume que la unidad vuelve utilizable", async ({
    inv,
    escenario,
  }) => {
    const dispositivo = await escenario.dispositivo(5);
    await inv.enviarAMantenimiento(dispositivo.id, 2);

    await inv.movimiento({
      tipo: "MANTENIMIENTO_SALIDA",
      detalles: [{ dispositivoId: dispositivo.id, cantidad: 2 }],
    });

    expect(await inv.existencias(dispositivo.id)).toMatchObject({ DISPONIBLE: 5, MANTENIMIENTO: 0 });
  });

  test.describe("unidad física específica", () => {
    test("manda a mantenimiento exactamente la unidad indicada", async ({ inv, escenario }) => {
      const dispositivo = await escenario.dispositivo(5);
      const unidades = await inv.unidades(dispositivo.id);
      const elegida = unidades[3];

      await inv.enviarAMantenimiento(dispositivo.id, 1, "Falla puntual", elegida.id);

      const despues = await inv.unidades(dispositivo.id);
      expect(despues.find((u) => u.id === elegida.id)?.estado).toBe("MANTENIMIENTO");
      expect(despues.filter((u) => u.estado === "MANTENIMIENTO")).toHaveLength(1);

      // El movimiento deja registrada la unidad exacta, no solo la cantidad.
      const ligadas = await db.movimientoDetalleUnidad.findMany({
        where: { unidadFisicaId: elegida.id },
      });
      expect(ligadas).toHaveLength(1);
    });

    test("rechaza la unidad que no está en el estado esperado", async ({ inv, escenario }) => {
      const dispositivo = await escenario.dispositivo(4);
      const [unidad] = await inv.unidades(dispositivo.id);
      await inv.enviarAMantenimiento(dispositivo.id, 1, "Primera vez", unidad.id);

      const res = await inv.post("/inventario/movimientos", {
        tipo: "MANTENIMIENTO_ENTRADA",
        detalles: [{ dispositivoId: dispositivo.id, cantidad: 1, unidadId: unidad.id }],
      });

      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({
        message: `La unidad ${unidad.activoFijo} está en estado MANTENIMIENTO; se esperaba DISPONIBLE`,
      });
    });

    test("rechaza la unidad que pertenece a otro dispositivo", async ({ inv, escenario }) => {
      const uno = await escenario.dispositivo(3);
      const otro = await escenario.dispositivo(3);
      const [unidadDeOtro] = await inv.unidades(otro.id);

      const res = await inv.post("/inventario/movimientos", {
        tipo: "MANTENIMIENTO_ENTRADA",
        detalles: [{ dispositivoId: uno.id, cantidad: 1, unidadId: unidadDeOtro.id }],
      });

      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({
        message: "La unidad no pertenece al dispositivo seleccionado",
      });
      expect(await inv.existencias(uno.id)).toMatchObject({ DISPONIBLE: 3 });
      expect(await inv.existencias(otro.id)).toMatchObject({ DISPONIBLE: 3 });
    });

    test("una unidad específica no puede mover más de una pieza", async ({ inv, escenario }) => {
      const dispositivo = await escenario.dispositivo(5);
      const [unidad] = await inv.unidades(dispositivo.id);

      const res = await inv.post("/inventario/movimientos", {
        tipo: "MANTENIMIENTO_ENTRADA",
        detalles: [{ dispositivoId: dispositivo.id, cantidad: 2, unidadId: unidad.id }],
      });

      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({
        message: "La selección de unidad física aplica a una sola unidad",
      });
    });
  });

  test.describe("validaciones", () => {
    test("no deja enviar a mantenimiento más de lo disponible", async ({ inv, escenario }) => {
      const dispositivo = await escenario.dispositivo(3);

      const res = await inv.post("/inventario/movimientos", {
        tipo: "MANTENIMIENTO_ENTRADA",
        detalles: [{ dispositivoId: dispositivo.id, cantidad: 5 }],
      });

      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({
        message: expect.stringContaining("se requieren 5, hay 3"),
      });
      expect(await inv.existencias(dispositivo.id)).toMatchObject({ DISPONIBLE: 3, MANTENIMIENTO: 0 });
    });

    test("no deja sacar de mantenimiento lo que nunca entró", async ({ inv, escenario }) => {
      const dispositivo = await escenario.dispositivo(4);
      await inv.enviarAMantenimiento(dispositivo.id, 1);

      const res = await inv.post("/inventario/movimientos", {
        tipo: "MANTENIMIENTO_SALIDA",
        detalles: [{ dispositivoId: dispositivo.id, cantidad: 3, condicion: "BUENO" }],
      });

      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({
        message: expect.stringContaining("No hay suficientes unidades en mantenimiento"),
      });
      expect(await inv.existencias(dispositivo.id)).toMatchObject({ DISPONIBLE: 3, MANTENIMIENTO: 1 });
    });

    test("rechaza una condición fuera del catálogo", async ({ inv, escenario }) => {
      const dispositivo = await escenario.dispositivo(3);
      await inv.enviarAMantenimiento(dispositivo.id, 1);

      const res = await inv.post("/inventario/movimientos", {
        tipo: "MANTENIMIENTO_SALIDA",
        detalles: [{ dispositivoId: dispositivo.id, cantidad: 1, condicion: "EXCELENTE" }],
      });
      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ error: "ValidationError" });
    });

    test("rechaza un dispositivo inexistente", async ({ inv }) => {
      const res = await inv.post("/inventario/movimientos", {
        tipo: "MANTENIMIENTO_ENTRADA",
        detalles: [
          { dispositivoId: "00000000-0000-0000-0000-000000000000", cantidad: 1 },
        ],
      });
      expect(res.status).toBe(404);
    });
  });

  test.describe("reversión", () => {
    test("revertir una entrada regresa las unidades y cancela el movimiento original", async ({
      inv,
      escenario,
    }) => {
      const dispositivo = await escenario.dispositivo(8);
      const entrada = await inv.enviarAMantenimiento(dispositivo.id, 3, "Enviado por error");
      expect(await inv.existencias(dispositivo.id)).toMatchObject({ DISPONIBLE: 5, MANTENIMIENTO: 3 });

      const reversion = await inv.revertir(entrada.id);

      expect(reversion).toMatchObject({
        tipo: "REVERSION",
        motivo: "Reversión de MANTENIMIENTO_ENTRADA",
        reversaDeId: entrada.id,
      });
      expect(await inv.existencias(dispositivo.id)).toMatchObject({
        DISPONIBLE: 8,
        MANTENIMIENTO: 0,
      });

      // El histórico se conserva: el original queda CANCELADO, no borrado (§24).
      expect((await inv.verMovimiento(entrada.id)).status).toBe("CANCELADO");
      expect(await inv.listarMovimientos({ dispositivoId: dispositivo.id })).toHaveLength(3);
    });

    test("revertir una salida devuelve las unidades al taller", async ({ inv, escenario }) => {
      const dispositivo = await escenario.dispositivo(6);
      await inv.enviarAMantenimiento(dispositivo.id, 4);
      const salida = await inv.sacarDeMantenimiento(dispositivo.id, 3, "BUENO");
      expect(await inv.existencias(dispositivo.id)).toMatchObject({ DISPONIBLE: 5, MANTENIMIENTO: 1 });

      await inv.revertir(salida.id);

      expect(await inv.existencias(dispositivo.id)).toMatchObject({
        DISPONIBLE: 2,
        MANTENIMIENTO: 4,
        activa: 6,
      });
    });

    test("revertir la entrada de una unidad específica devuelve esa misma unidad", async ({
      inv,
      escenario,
    }) => {
      const dispositivo = await escenario.dispositivo(5);
      const unidades = await inv.unidades(dispositivo.id);
      const elegida = unidades[2];
      const entrada = await inv.enviarAMantenimiento(dispositivo.id, 1, "Puntual", elegida.id);

      await inv.revertir(entrada.id);

      const despues = await inv.unidades(dispositivo.id);
      expect(despues.find((u) => u.id === elegida.id)?.estado).toBe("DISPONIBLE");
      expect(despues.filter((u) => u.estado === "MANTENIMIENTO")).toHaveLength(0);
    });

    test("un movimiento no se puede revertir dos veces", async ({ inv, escenario }) => {
      const dispositivo = await escenario.dispositivo(5);
      const entrada = await inv.enviarAMantenimiento(dispositivo.id, 2);
      await inv.revertir(entrada.id);

      const res = await inv.post(`/inventario/movimientos/${entrada.id}/revertir`);
      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({ message: "El movimiento ya fue revertido" });
      expect(await inv.existencias(dispositivo.id)).toMatchObject({ DISPONIBLE: 5 });
    });

    test("una baja no admite reversión", async ({ inv, escenario }) => {
      const dispositivo = await escenario.dispositivo(5);
      const baja = await inv.darDeBaja(dispositivo.id, 1, "Daño irreparable");

      const res = await inv.post(`/inventario/movimientos/${baja.id}/revertir`);
      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({
        message: "Este tipo de movimiento no admite reversión",
      });
      expect(await inv.existencias(dispositivo.id)).toMatchObject({ BAJA: 1, DISPONIBLE: 4 });
    });

    test("revertir un movimiento inexistente da 404", async ({ inv }) => {
      const res = await inv.post(
        "/inventario/movimientos/00000000-0000-0000-0000-000000000000/revertir"
      );
      expect(res.status).toBe(404);
    });
  });

  test("el kardex refleja entradas y salidas de mantenimiento", async ({ inv, escenario }) => {
    const dispositivo = await escenario.dispositivo(10);
    await inv.enviarAMantenimiento(dispositivo.id, 4, "Revisión");
    await inv.sacarDeMantenimiento(dispositivo.id, 4, "BUENO");

    const kardex = await inv.kardex(dispositivo.id);
    expect(kardex.rows.map((r) => [r.tipo, r.entrada, r.salida, r.saldo])).toEqual([
      ["ENTRADA", 10, 0, 10],
      ["MANTENIMIENTO_ENTRADA", 0, 4, 6],
      ["MANTENIMIENTO_SALIDA", 4, 0, 10],
    ]);
    expect(kardex.existencias).toMatchObject({ DISPONIBLE: 10, MANTENIMIENTO: 0 });
  });

  test("un EMPLEADO no puede mover ni revertir mantenimiento", async ({
    inv,
    invEmpleado,
    escenario,
  }) => {
    const dispositivo = await escenario.dispositivo(4);
    const entrada = await inv.enviarAMantenimiento(dispositivo.id, 1);

    expect(
      (
        await invEmpleado.post("/inventario/movimientos", {
          tipo: "MANTENIMIENTO_ENTRADA",
          detalles: [{ dispositivoId: dispositivo.id, cantidad: 1 }],
        })
      ).status
    ).toBe(403);

    expect((await invEmpleado.post(`/inventario/movimientos/${entrada.id}/revertir`)).status).toBe(403);
    expect(await inv.existencias(dispositivo.id)).toMatchObject({ MANTENIMIENTO: 1 });
  });
});
