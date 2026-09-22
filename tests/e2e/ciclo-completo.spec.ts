import { test, expect } from "./support/fixtures";
import { estadosEnBase } from "./support/db";
import type { Existencias, InventarioApi } from "./support/inventario-api";

/**
 * Ciclo de vida completo — DISPOSITIVOS.md §26 y §28.
 *
 * Recorre ALTA → PRÉSTAMO → DEVOLUCIÓN → MANTENIMIENTO → BAJA sobre los mismos
 * dispositivos y verifica en cada paso la regla de consistencia:
 *
 *     activa    = DISPONIBLE + PRESTADO + DANADO + MANTENIMIENTO
 *     histórica = activa + BAJA
 *
 * y que lo que reporta la API coincide con lo que hay en la base.
 */
const verificarConsistencia = async (
  inv: InventarioApi,
  dispositivoId: string,
  esperado: Partial<Existencias>
): Promise<Existencias> => {
  const ex = await inv.existencias(dispositivoId);

  expect(ex).toMatchObject(esperado);
  expect(ex.activa).toBe(ex.DISPONIBLE + ex.PRESTADO + ex.DANADO + ex.MANTENIMIENTO);
  expect(ex.historica).toBe(ex.activa + ex.BAJA);

  // Contraste contra la base: la API no puede estar reportando algo que no existe.
  const enBase = await estadosEnBase(dispositivoId);
  for (const estado of ["DISPONIBLE", "PRESTADO", "DANADO", "MANTENIMIENTO", "BAJA"] as const) {
    expect(enBase[estado] ?? 0).toBe(ex[estado]);
  }
  return ex;
};

test.describe("Ciclo de vida completo del inventario", () => {
  test("alta → préstamo → devolución → mantenimiento → baja", async ({
    inv,
    escenario,
    departamentoId,
  }) => {
    let samsungId = "";
    let ipadId = "";
    let prestamoId = "";
    let detalleSamsungId = "";
    let detalleIpadId = "";

    await test.step("1. Alta: Samsung A9 → 15 y iPad Pro → 50", async () => {
      const samsung = await escenario.dispositivo(15, { nombre: `Samsung A9 ${escenario.tipo.code}` });
      const ipad = await escenario.dispositivo(50, { nombre: `iPad Pro ${escenario.tipo.code}` });
      samsungId = samsung.id;
      ipadId = ipad.id;

      await verificarConsistencia(inv, samsungId, { DISPONIBLE: 15, activa: 15, historica: 15 });
      await verificarConsistencia(inv, ipadId, { DISPONIBLE: 50, activa: 50, historica: 50 });
    });

    await test.step("2. Préstamo: Samsung 10 e iPad 5 en un solo movimiento", async () => {
      const { prestamo } = await inv.prestar({
        departamentoId,
        observaciones: "Entrega para proyecto X",
        detalles: [
          { dispositivoId: samsungId, cantidad: 10 },
          { dispositivoId: ipadId, cantidad: 5 },
        ],
      });
      prestamoId = prestamo.id;
      detalleSamsungId = prestamo.detalles.find((d) => d.dispositivoId === samsungId)!.id;
      detalleIpadId = prestamo.detalles.find((d) => d.dispositivoId === ipadId)!.id;

      expect(prestamo.status).toBe("ACTIVO");
      await verificarConsistencia(inv, samsungId, { DISPONIBLE: 5, PRESTADO: 10, activa: 15 });
      await verificarConsistencia(inv, ipadId, { DISPONIBLE: 45, PRESTADO: 5, activa: 50 });
    });

    await test.step("3. Devolución parcial: Samsung 4 e iPad 2 en buen estado", async () => {
      await inv.devolver({
        prestamoId,
        detalles: [
          { prestamoDetalleId: detalleSamsungId, cantidad: 4, condicion: "BUENO" },
          { prestamoDetalleId: detalleIpadId, cantidad: 2, condicion: "BUENO" },
        ],
      });

      const prestamo = await inv.prestamo(prestamoId);
      expect(prestamo.status).toBe("PARCIAL");
      await verificarConsistencia(inv, samsungId, { DISPONIBLE: 9, PRESTADO: 6, activa: 15 });
      await verificarConsistencia(inv, ipadId, { DISPONIBLE: 47, PRESTADO: 3, activa: 50 });
    });

    await test.step("4. Devolución del resto: 1 Samsung vuelve ROTO y se da de baja sola", async () => {
      await inv.devolver({
        prestamoId,
        detalles: [
          { prestamoDetalleId: detalleSamsungId, cantidad: 5, condicion: "BUENO" },
          { prestamoDetalleId: detalleSamsungId, cantidad: 1, condicion: "ROTO" },
          { prestamoDetalleId: detalleIpadId, cantidad: 3, condicion: "BUENO" },
        ],
      });

      const prestamo = await inv.prestamo(prestamoId);
      expect(prestamo.status).toBe("DEVUELTO");
      expect(prestamo.detalles.every((d) => d.devuelto === d.cantidad)).toBe(true);

      await verificarConsistencia(inv, samsungId, {
        DISPONIBLE: 14,
        PRESTADO: 0,
        BAJA: 1,
        activa: 14,
        historica: 15,
      });
      await verificarConsistencia(inv, ipadId, { DISPONIBLE: 50, PRESTADO: 0, activa: 50 });
    });

    await test.step("5. Mantenimiento: 3 Samsung al taller, 2 vuelven bien y 1 dañada", async () => {
      await inv.enviarAMantenimiento(samsungId, 3, "Revisión de batería");
      await verificarConsistencia(inv, samsungId, {
        DISPONIBLE: 11,
        MANTENIMIENTO: 3,
        activa: 14,
      });

      await inv.sacarDeMantenimiento(samsungId, 2, "BUENO");
      await inv.sacarDeMantenimiento(samsungId, 1, "MALO");
      await verificarConsistencia(inv, samsungId, {
        DISPONIBLE: 13,
        MANTENIMIENTO: 0,
        DANADO: 1,
        activa: 14,
        historica: 15,
      });
    });

    await test.step("6. Baja: 2 Samsung por daño irreparable", async () => {
      await inv.darDeBaja(samsungId, 2, "Daño irreparable");

      await verificarConsistencia(inv, samsungId, {
        DISPONIBLE: 11,
        PRESTADO: 0,
        DANADO: 1,
        MANTENIMIENTO: 0,
        BAJA: 3,
        activa: 12,
        historica: 15,
      });
    });

    await test.step("7. El kardex cuenta la historia completa y cuadra con las existencias", async () => {
      const kardex = await inv.kardex(samsungId);

      expect(kardex.rows.map((r) => r.tipo)).toEqual([
        "ENTRADA",
        "PRESTAMO",
        "DEVOLUCION",
        "DEVOLUCION",
        "DEVOLUCION",
        "BAJA",
        "MANTENIMIENTO_ENTRADA",
        "MANTENIMIENTO_SALIDA",
        "MANTENIMIENTO_SALIDA",
        "BAJA",
      ]);

      // El saldo del kardex es el inventario que sigue en circulación:
      // lo activo menos lo que está dañado y fuera de uso no se descuenta aquí,
      // pero sí todas las salidas registradas.
      const ultimo = kardex.rows[kardex.rows.length - 1];
      expect(ultimo.saldo).toBe(
        kardex.rows.reduce((acc, r) => acc + r.entrada - r.salida, 0)
      );
      expect(kardex.existencias).toMatchObject({ BAJA: 3, activa: 12, historica: 15 });
    });

    await test.step("8. Nada del histórico se borró", async () => {
      const movimientos = await inv.listarMovimientos({ dispositivoId: samsungId });

      // 9 movimientos y 10 renglones de kardex: la devolución del paso 4 llevó
      // dos líneas (5 BUENO + 1 ROTO) dentro de un mismo movimiento.
      expect(movimientos).toHaveLength(9);
      expect((await inv.kardex(samsungId)).rows).toHaveLength(10);

      // Ningún movimiento fue eliminado; sólo se cancelan por reversión (§24).
      expect(movimientos.every((m) => m.status === "ACTIVO")).toBe(true);
    });
  });

  test("la existencia histórica nunca baja, pase lo que pase con la activa", async ({
    inv,
    escenario,
    departamentoId,
  }) => {
    const dispositivo = await escenario.dispositivo(12);
    const historica = 12;

    const pasos: (() => Promise<unknown>)[] = [
      () => inv.prestar({ departamentoId, detalles: [{ dispositivoId: dispositivo.id, cantidad: 4 }] }),
      () => inv.enviarAMantenimiento(dispositivo.id, 3, "Revisión"),
      () => inv.sacarDeMantenimiento(dispositivo.id, 3, "MALO"),
      () => inv.darDeBaja(dispositivo.id, 2, "Obsoletas"),
    ];

    for (const paso of pasos) {
      await paso();
      const ex = await verificarConsistencia(inv, dispositivo.id, {});
      expect(ex.historica).toBe(historica);
    }

    expect(await inv.existencias(dispositivo.id)).toMatchObject({
      DISPONIBLE: 3,
      PRESTADO: 4,
      DANADO: 3,
      MANTENIMIENTO: 0,
      BAJA: 2,
      activa: 10,
      historica: 12,
    });
  });
});
