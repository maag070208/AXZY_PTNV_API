import { test, expect } from "./support/fixtures";
import { db, statusesInDb } from "./support/db";

/**
 * Flujo PRÉSTAMOS — DISPOSITIVOS.md §8 a §14, §21 y §22.
 *
 * El préstamo entra por `POST /inventario/prestamos` y la devolución por
 * `POST /inventario/devoluciones`, siempre ligada a un detalle del préstamo.
 */
test.describe("PRÉSTAMOS", () => {
  test("presta 10 de 15 unidades y descuenta las disponibles", async ({
    inv,
    scenario,
    departmentId,
  }) => {
    const samsung = await scenario.device(15);

    const { loan } = await inv.lend({
      departmentId,
      notes: "Entrega para proyecto X",
      items: [{ deviceId: samsung.id, quantity: 10 }],
    });

    expect(await inv.stock(samsung.id)).toMatchObject({
      AVAILABLE: 5,
      ON_LOAN: 10,
      active: 15,
    });
    expect(loan.status).toBe("ACTIVE");
    expect(loan.number).toMatch(/^CARTA-\d{4}$/);

    // El folio sale del más alto de la serie, no de un `count()`: en la base
    // conviven las cartas migradas del sistema viejo (`LPT-0001`, `CTM-0001`…),
    // que cuentan sin pertenecer a la serie, y los borrados dejan huecos. Con
    // `count() + 1` el folio caía sobre uno ya usado y el `@unique` daba 409.
    const folios = (await db.loan.findMany({
      where: { number: { startsWith: "CARTA-" } },
      select: { number: true },
    })).map((p) => Number(p.number.slice("CARTA-".length)));
    const own = Number(loan.number.slice("CARTA-".length));
    expect(own).toBe(Math.max(...folios));
    expect(folios.filter((f) => f === own)).toHaveLength(1);
    expect(loan.items[0]).toMatchObject({ quantity: 10, returnedQuantity: 0 });

    // Las unidades concretas quedaron ligadas al préstamo y marcadas al departamento.
    const linked = await db.loanItemUnit.findMany({
      where: { loanItemId: loan.items[0].id },
      include: { deviceUnit: true },
    });
    expect(linked).toHaveLength(10);
    expect(linked.every((u) => u.returned === false)).toBe(true);
    expect(linked.every((u) => u.deviceUnit.status === "ON_LOAN")).toBe(true);
    expect(linked.every((u) => u.deviceUnit.departmentId === departmentId)).toBe(true);
  });

  test("un solo préstamo puede llevar varios dispositivos y valida cada uno", async ({
    inv,
    scenario,
    departmentId,
  }) => {
    const samsung = await scenario.device(15);
    const ipad = await scenario.device(50);

    const { loan } = await inv.lend({
      departmentId,
      items: [
        { deviceId: samsung.id, quantity: 5 },
        { deviceId: ipad.id, quantity: 8 },
      ],
    });

    expect(loan.items).toHaveLength(2);
    expect(await inv.stock(samsung.id)).toMatchObject({ AVAILABLE: 10, ON_LOAN: 5 });
    expect(await inv.stock(ipad.id)).toMatchObject({ AVAILABLE: 42, ON_LOAN: 8 });
  });

  test("rechaza el préstamo sin existencias suficientes y no mueve el inventario", async ({
    inv,
    scenario,
    departmentId,
  }) => {
    const device = await scenario.device(5);

    const res = await inv.post("/inventory/loans", {
      departmentId,
      items: [{ deviceId: device.id, quantity: 8 }],
    });

    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ message: expect.stringContaining("se requieren 8, hay 5") });
    // Nunca queda inventario negativo ni un préstamo a medias (§10).
    expect(await inv.stock(device.id)).toMatchObject({ AVAILABLE: 5, ON_LOAN: 0 });
    expect(await db.loanItem.count({ where: { deviceId: device.id } })).toBe(0);
  });

  test("un préstamo con varios dispositivos se revierte completo si uno falla", async ({
    inv,
    scenario,
    departmentId,
  }) => {
    const enough = await scenario.device(10);
    const scarce = await scenario.device(2);

    const res = await inv.post("/inventory/loans", {
      departmentId,
      items: [
        { deviceId: enough.id, quantity: 4 },
        { deviceId: scarce.id, quantity: 9 },
      ],
    });

    expect(res.status).toBe(409);
    expect(await inv.stock(enough.id)).toMatchObject({ AVAILABLE: 10, ON_LOAN: 0 });
    expect(await inv.stock(scarce.id)).toMatchObject({ AVAILABLE: 2, ON_LOAN: 0 });
  });

  test("exige responsable o departamento", async ({ inv, scenario }) => {
    const device = await scenario.device(3);

    const res = await inv.post("/inventory/loans", {
      items: [{ deviceId: device.id, quantity: 1 }],
    });
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toContain("Indica un responsable o un departamento");
  });

  test.describe("returns", () => {
    test("la devolución parcial deja el préstamo en PARCIAL con el pendiente correcto", async ({
      inv,
      scenario,
      departmentId,
    }) => {
      const device = await scenario.device(15);
      const { loan } = await inv.lend({
        departmentId,
        items: [{ deviceId: device.id, quantity: 10 }],
      });

      await inv.returnLoan({
        loanId: loan.id,
        items: [{ loanItemId: loan.items[0].id, quantity: 4, condition: "GOOD" }],
      });

      expect(await inv.stock(device.id)).toMatchObject({ AVAILABLE: 9, ON_LOAN: 6 });

      const updated = await inv.loan(loan.id);
      expect(updated.status).toBe("PARTIAL");
      // No se crea un segundo préstamo para el pendiente (§13).
      expect(updated.items).toHaveLength(1);
      expect(updated.items[0]).toMatchObject({ quantity: 10, returnedQuantity: 4 });
      expect(updated.returns).toHaveLength(1);
    });

    test("la devolución total deja el préstamo en DEVUELTO", async ({
      inv,
      scenario,
      departmentId,
    }) => {
      const device = await scenario.device(15);
      const { loan } = await inv.lend({
        departmentId,
        items: [{ deviceId: device.id, quantity: 6 }],
      });
      const itemId = loan.items[0].id;

      await inv.returnLoan({
        loanId: loan.id,
        items: [{ loanItemId: itemId, quantity: 6, condition: "GOOD" }],
      });

      expect(await inv.stock(device.id)).toMatchObject({ AVAILABLE: 15, ON_LOAN: 0 });
      const updated = await inv.loan(loan.id);
      expect(updated.status).toBe("RETURNED");
      expect(updated.items[0]).toMatchObject({ quantity: 6, returnedQuantity: 6 });
    });

    test("la devolución en varias partes acumula el devuelto hasta cerrar el préstamo", async ({
      inv,
      scenario,
      departmentId,
    }) => {
      const device = await scenario.device(15);
      const { loan } = await inv.lend({
        departmentId,
        items: [{ deviceId: device.id, quantity: 10 }],
      });
      const itemId = loan.items[0].id;

      await inv.returnLoan({
        loanId: loan.id,
        items: [{ loanItemId: itemId, quantity: 4, condition: "GOOD" }],
      });
      expect((await inv.loan(loan.id)).status).toBe("PARTIAL");

      await inv.returnLoan({
        loanId: loan.id,
        items: [{ loanItemId: itemId, quantity: 6, condition: "GOOD" }],
      });

      const closed = await inv.loan(loan.id);
      expect(closed.status).toBe("RETURNED");
      expect(closed.items[0]).toMatchObject({ quantity: 10, returnedQuantity: 10 });
      expect(closed.returns).toHaveLength(2);
      expect(await inv.stock(device.id)).toMatchObject({ AVAILABLE: 15, ON_LOAN: 0 });
    });

    test("cada condición de devolución manda la unidad al estado que le toca", async ({
      inv,
      scenario,
      departmentId,
    }) => {
      const device = await scenario.device(10);
      const { loan } = await inv.lend({
        departmentId,
        items: [{ deviceId: device.id, quantity: 8 }],
      });
      const itemId = loan.items[0].id;

      await inv.returnLoan({
        loanId: loan.id,
        items: [
          { loanItemId: itemId, quantity: 3, condition: "GOOD" },
          { loanItemId: itemId, quantity: 2, condition: "FAIR" },
        ],
      });
      // BUENO y ACEPTABLE regresan al inventario disponible.
      expect(await inv.stock(device.id)).toMatchObject({ AVAILABLE: 7, ON_LOAN: 3 });
      // Las dos líneas viajaron en la misma devolución: el devuelto las suma (§14).
      expect((await inv.loan(loan.id)).items[0]).toMatchObject({
        quantity: 8,
        returnedQuantity: 5,
      });

      await inv.returnLoan({
        loanId: loan.id,
        items: [{ loanItemId: itemId, quantity: 2, condition: "POOR" }],
      });
      // MALO cuenta como dañado: sigue siendo existencia activa, pero no disponible.
      expect(await inv.stock(device.id)).toMatchObject({
        AVAILABLE: 7,
        ON_LOAN: 1,
        DAMAGED: 2,
        active: 10,
      });
    });

    test("la unidad devuelta como ROTO se da de baja automáticamente", async ({
      inv,
      scenario,
      departmentId,
    }) => {
      const device = await scenario.device(10);
      const { loan } = await inv.lend({
        departmentId,
        items: [{ deviceId: device.id, quantity: 4 }],
      });

      await inv.returnLoan({
        loanId: loan.id,
        items: [
          {
            loanItemId: loan.items[0].id,
            quantity: 2,
            condition: "BROKEN",
            notes: "Pantalla destrozada",
          },
        ],
      });

      expect(await inv.stock(device.id)).toMatchObject({
        AVAILABLE: 6,
        ON_LOAN: 2,
        RETIREMENT: 2,
        active: 8,
        historical: 10,
      });

      // Además del movimiento de DEVOLUCION queda la BAJA automática que lo respalda.
      const retirements = await inv.listMovements({ deviceId: device.id, type: "RETIREMENT" });
      expect(retirements).toHaveLength(1);
      expect(retirements[0].reason).toBe("Baja automática por estado ROTO");
      expect(retirements[0].items.every((d) => d.condition === "BROKEN")).toBe(true);
    });

    test("rechaza devolver más de lo pendiente", async ({ inv, scenario, departmentId }) => {
      const device = await scenario.device(10);
      const { loan } = await inv.lend({
        departmentId,
        items: [{ deviceId: device.id, quantity: 5 }],
      });
      const itemId = loan.items[0].id;
      await inv.returnLoan({
        loanId: loan.id,
        items: [{ loanItemId: itemId, quantity: 3, condition: "GOOD" }],
      });

      const res = await inv.post("/inventory/returns", {
        loanId: loan.id,
        items: [{ loanItemId: itemId, quantity: 5, condition: "GOOD" }],
      });

      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({
        message: "La devolución excede el pendiente (2) del detalle",
      });
      expect(await inv.stock(device.id)).toMatchObject({ AVAILABLE: 8, ON_LOAN: 2 });
    });

    test("rechaza devolver sobre un préstamo ya cerrado", async ({
      inv,
      scenario,
      departmentId,
    }) => {
      const device = await scenario.device(4);
      const { loan } = await inv.lend({
        departmentId,
        items: [{ deviceId: device.id, quantity: 2 }],
      });
      const itemId = loan.items[0].id;
      await inv.returnLoan({
        loanId: loan.id,
        items: [{ loanItemId: itemId, quantity: 2, condition: "GOOD" }],
      });

      const res = await inv.post("/inventory/returns", {
        loanId: loan.id,
        items: [{ loanItemId: itemId, quantity: 1, condition: "GOOD" }],
      });
      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({ message: "El préstamo ya está devuelto o cancelado" });
    });

    test("rechaza una devolución sin detalle de préstamo válido", async ({
      inv,
      scenario,
      departmentId,
    }) => {
      const device = await scenario.device(4);
      const { loan } = await inv.lend({
        departmentId,
        items: [{ deviceId: device.id, quantity: 2 }],
      });

      const others = await inv.post("/inventory/returns", {
        loanId: loan.id,
        items: [
          {
            loanItemId: "00000000-0000-0000-0000-000000000000",
            quantity: 1,
            condition: "GOOD",
          },
        ],
      });
      expect(others.status).toBe(404);

      const withoutCondition = await inv.post("/inventory/returns", {
        loanId: loan.id,
        items: [{ loanItemId: loan.items[0].id, quantity: 1 }],
      });
      expect(withoutCondition.status).toBe(400);
      expect(withoutCondition.body).toMatchObject({ error: "ValidationError" });
    });
  });

  test.describe("cancelación y edición", () => {
    test("cancelar libera las unidades pendientes", async ({
      inv,
      scenario,
      departmentId,
    }) => {
      const device = await scenario.device(10);
      const { loan } = await inv.lend({
        departmentId,
        items: [{ deviceId: device.id, quantity: 6 }],
      });

      const cancelled = await inv.cancelLoan(loan.id);
      expect(cancelled.status).toBe("CANCELLED");
      expect(await inv.stock(device.id)).toMatchObject({ AVAILABLE: 10, ON_LOAN: 0 });

      const item = await db.loanItem.findFirstOrThrow({
        where: { loanId: loan.id },
      });
      expect(item.returnedQuantity).toBe(item.quantity);
    });

    test("cancelar respeta lo ya devuelto y no lo cuenta dos veces", async ({
      inv,
      scenario,
      departmentId,
    }) => {
      const device = await scenario.device(10);
      const { loan } = await inv.lend({
        departmentId,
        items: [{ deviceId: device.id, quantity: 6 }],
      });
      await inv.returnLoan({
        loanId: loan.id,
        items: [{ loanItemId: loan.items[0].id, quantity: 2, condition: "POOR" }],
      });

      await inv.cancelLoan(loan.id);

      // Las 2 devueltas siguen dañadas; las 4 pendientes vuelven a disponibles.
      expect(await inv.stock(device.id)).toMatchObject({
        AVAILABLE: 8,
        DAMAGED: 2,
        ON_LOAN: 0,
        active: 10,
      });
    });

    test("no se puede cancelar dos veces", async ({ inv, scenario, departmentId }) => {
      const device = await scenario.device(4);
      const { loan } = await inv.lend({
        departmentId,
        items: [{ deviceId: device.id, quantity: 2 }],
      });
      await inv.cancelLoan(loan.id);

      const res = await inv.post(`/inventory/loans/${loan.id}/cancel`);
      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({ message: "El préstamo ya está devuelto o cancelado" });
    });

    test("editar la cantidad reasigna las unidades mientras no haya devoluciones", async ({
      inv,
      scenario,
      departmentId,
    }) => {
      const device = await scenario.device(10);
      const { loan } = await inv.lend({
        departmentId,
        items: [{ deviceId: device.id, quantity: 5 }],
      });

      const edited = await inv.updateLoan(loan.id, { quantity: 3 });

      expect(edited.items[0].quantity).toBe(3);
      expect(await inv.stock(device.id)).toMatchObject({ AVAILABLE: 7, ON_LOAN: 3 });
      expect(
        await db.loanItemUnit.count({ where: { loanItemId: loan.items[0].id } })
      ).toBe(3);
    });

    test("editar el recurso ya no se permite si hubo devoluciones", async ({
      inv,
      scenario,
      departmentId,
    }) => {
      const device = await scenario.device(10);
      const { loan } = await inv.lend({
        departmentId,
        items: [{ deviceId: device.id, quantity: 5 }],
      });
      await inv.returnLoan({
        loanId: loan.id,
        items: [{ loanItemId: loan.items[0].id, quantity: 1, condition: "GOOD" }],
      });

      const res = await inv.put(`/inventory/loans/${loan.id}`, { quantity: 2 });
      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({
        message:
          "El préstamo ya tiene devoluciones; no se puede editar el recurso, solo la asignación",
      });

      // La asignación sí se puede seguir corrigiendo.
      const onlyNotes = await inv.updateLoan(loan.id, {
        notes: "Corrección de captura",
      });
      expect(onlyNotes.notes).toBe("Corrección de captura");
    });

    test("editar la cantidad hacia arriba valida que alcancen las existencias", async ({
      inv,
      scenario,
      departmentId,
    }) => {
      const device = await scenario.device(6);
      const { loan } = await inv.lend({
        departmentId,
        items: [{ deviceId: device.id, quantity: 4 }],
      });

      const res = await inv.put(`/inventory/loans/${loan.id}`, { quantity: 9 });
      expect(res.status).toBe(409);
      expect(await inv.stock(device.id)).toMatchObject({ AVAILABLE: 2, ON_LOAN: 4 });
    });
  });

  test("varios préstamos simultáneos nunca asignan la misma unidad dos veces", async ({
    inv,
    scenario,
    departmentId,
  }) => {
    const device = await scenario.device(5);

    const responses = await Promise.all(
      Array.from({ length: 5 }, () =>
        inv.post("/inventory/loans", {
          departmentId,
          items: [{ deviceId: device.id, quantity: 1 }],
        })
      )
    );

    const successful = responses.filter((r) => r.status === 201).length;
    expect(successful).toBeGreaterThan(0);

    // Invariante duro: ninguna unidad puede estar ligada a dos préstamos y el
    // total de piezas se conserva, pase lo que pase con la concurrencia.
    const linked = await db.loanItemUnit.findMany({
      where: { deviceUnit: { deviceId: device.id } },
      select: { deviceUnitId: true },
    });
    expect(new Set(linked.map((l) => l.deviceUnitId)).size).toBe(linked.length);

    const statuses = await statusesInDb(device.id);
    expect((statuses.AVAILABLE ?? 0) + (statuses.ON_LOAN ?? 0)).toBe(5);
    expect(statuses.ON_LOAN ?? 0).toBe(successful);
  });

  test("un EMPLEADO no puede prestar ni devolver", async ({
    inv,
    invEmployee,
    scenario,
    departmentId,
  }) => {
    const device = await scenario.device(4);
    const { loan } = await inv.lend({
      departmentId,
      items: [{ deviceId: device.id, quantity: 2 }],
    });

    expect(
      (
        await invEmployee.post("/inventory/loans", {
          departmentId,
          items: [{ deviceId: device.id, quantity: 1 }],
        })
      ).status
    ).toBe(403);

    expect(
      (
        await invEmployee.post("/inventory/returns", {
          loanId: loan.id,
          items: [{ loanItemId: loan.items[0].id, quantity: 1, condition: "GOOD" }],
        })
      ).status
    ).toBe(403);

    // Y el EMPLEADO sí puede consultar: la lectura no está restringida.
    expect((await invEmployee.get("/inventory/loans")).status).toBe(200);
  });
});
