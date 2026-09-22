import { test, expect } from "./support/fixtures";
import { db, estadosEnBase } from "./support/db";

/**
 * Flujo PRÉSTAMOS — DISPOSITIVOS.md §8 a §14, §21 y §22.
 *
 * El préstamo entra por `POST /inventario/prestamos` y la devolución por
 * `POST /inventario/devoluciones`, siempre ligada a un detalle del préstamo.
 */
test.describe("PRÉSTAMOS", () => {
  test("presta 10 de 15 unidades y descuenta las disponibles", async ({
    inv,
    escenario,
    departamentoId,
  }) => {
    const samsung = await escenario.dispositivo(15);

    const { prestamo } = await inv.prestar({
      departamentoId,
      observaciones: "Entrega para proyecto X",
      detalles: [{ dispositivoId: samsung.id, cantidad: 10 }],
    });

    expect(await inv.existencias(samsung.id)).toMatchObject({
      DISPONIBLE: 5,
      PRESTADO: 10,
      activa: 15,
    });
    expect(prestamo.status).toBe("ACTIVO");
    expect(prestamo.consecutivo).toMatch(/^CARTA-\d{4}$/);
    expect(prestamo.detalles[0]).toMatchObject({ cantidad: 10, devuelto: 0 });

    // Las unidades concretas quedaron ligadas al préstamo y marcadas al departamento.
    const ligadas = await db.prestamoDetalleUnidad.findMany({
      where: { prestamoDetalleId: prestamo.detalles[0].id },
      include: { unidadFisica: true },
    });
    expect(ligadas).toHaveLength(10);
    expect(ligadas.every((u) => u.devuelto === false)).toBe(true);
    expect(ligadas.every((u) => u.unidadFisica.estado === "PRESTADO")).toBe(true);
    expect(ligadas.every((u) => u.unidadFisica.departamentoId === departamentoId)).toBe(true);
  });

  test("un solo préstamo puede llevar varios dispositivos y valida cada uno", async ({
    inv,
    escenario,
    departamentoId,
  }) => {
    const samsung = await escenario.dispositivo(15);
    const ipad = await escenario.dispositivo(50);

    const { prestamo } = await inv.prestar({
      departamentoId,
      detalles: [
        { dispositivoId: samsung.id, cantidad: 5 },
        { dispositivoId: ipad.id, cantidad: 8 },
      ],
    });

    expect(prestamo.detalles).toHaveLength(2);
    expect(await inv.existencias(samsung.id)).toMatchObject({ DISPONIBLE: 10, PRESTADO: 5 });
    expect(await inv.existencias(ipad.id)).toMatchObject({ DISPONIBLE: 42, PRESTADO: 8 });
  });

  test("rechaza el préstamo sin existencias suficientes y no mueve el inventario", async ({
    inv,
    escenario,
    departamentoId,
  }) => {
    const dispositivo = await escenario.dispositivo(5);

    const res = await inv.post("/inventario/prestamos", {
      departamentoId,
      detalles: [{ dispositivoId: dispositivo.id, cantidad: 8 }],
    });

    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ message: expect.stringContaining("se requieren 8, hay 5") });
    // Nunca queda inventario negativo ni un préstamo a medias (§10).
    expect(await inv.existencias(dispositivo.id)).toMatchObject({ DISPONIBLE: 5, PRESTADO: 0 });
    expect(await db.prestamoDetalle.count({ where: { dispositivoId: dispositivo.id } })).toBe(0);
  });

  test("un préstamo con varios dispositivos se revierte completo si uno falla", async ({
    inv,
    escenario,
    departamentoId,
  }) => {
    const suficiente = await escenario.dispositivo(10);
    const escaso = await escenario.dispositivo(2);

    const res = await inv.post("/inventario/prestamos", {
      departamentoId,
      detalles: [
        { dispositivoId: suficiente.id, cantidad: 4 },
        { dispositivoId: escaso.id, cantidad: 9 },
      ],
    });

    expect(res.status).toBe(409);
    expect(await inv.existencias(suficiente.id)).toMatchObject({ DISPONIBLE: 10, PRESTADO: 0 });
    expect(await inv.existencias(escaso.id)).toMatchObject({ DISPONIBLE: 2, PRESTADO: 0 });
  });

  test("exige responsable o departamento", async ({ inv, escenario }) => {
    const dispositivo = await escenario.dispositivo(3);

    const res = await inv.post("/inventario/prestamos", {
      detalles: [{ dispositivoId: dispositivo.id, cantidad: 1 }],
    });
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toContain("Indica un responsable o un departamento");
  });

  test.describe("devoluciones", () => {
    test("la devolución parcial deja el préstamo en PARCIAL con el pendiente correcto", async ({
      inv,
      escenario,
      departamentoId,
    }) => {
      const dispositivo = await escenario.dispositivo(15);
      const { prestamo } = await inv.prestar({
        departamentoId,
        detalles: [{ dispositivoId: dispositivo.id, cantidad: 10 }],
      });

      await inv.devolver({
        prestamoId: prestamo.id,
        detalles: [{ prestamoDetalleId: prestamo.detalles[0].id, cantidad: 4, condicion: "BUENO" }],
      });

      expect(await inv.existencias(dispositivo.id)).toMatchObject({ DISPONIBLE: 9, PRESTADO: 6 });

      const actualizado = await inv.prestamo(prestamo.id);
      expect(actualizado.status).toBe("PARCIAL");
      // No se crea un segundo préstamo para el pendiente (§13).
      expect(actualizado.detalles).toHaveLength(1);
      expect(actualizado.detalles[0]).toMatchObject({ cantidad: 10, devuelto: 4 });
      expect(actualizado.devoluciones).toHaveLength(1);
    });

    test("la devolución total deja el préstamo en DEVUELTO", async ({
      inv,
      escenario,
      departamentoId,
    }) => {
      const dispositivo = await escenario.dispositivo(15);
      const { prestamo } = await inv.prestar({
        departamentoId,
        detalles: [{ dispositivoId: dispositivo.id, cantidad: 6 }],
      });
      const detalleId = prestamo.detalles[0].id;

      await inv.devolver({
        prestamoId: prestamo.id,
        detalles: [{ prestamoDetalleId: detalleId, cantidad: 6, condicion: "BUENO" }],
      });

      expect(await inv.existencias(dispositivo.id)).toMatchObject({ DISPONIBLE: 15, PRESTADO: 0 });
      const actualizado = await inv.prestamo(prestamo.id);
      expect(actualizado.status).toBe("DEVUELTO");
      expect(actualizado.detalles[0]).toMatchObject({ cantidad: 6, devuelto: 6 });
    });

    test("la devolución en varias partes acumula el devuelto hasta cerrar el préstamo", async ({
      inv,
      escenario,
      departamentoId,
    }) => {
      const dispositivo = await escenario.dispositivo(15);
      const { prestamo } = await inv.prestar({
        departamentoId,
        detalles: [{ dispositivoId: dispositivo.id, cantidad: 10 }],
      });
      const detalleId = prestamo.detalles[0].id;

      await inv.devolver({
        prestamoId: prestamo.id,
        detalles: [{ prestamoDetalleId: detalleId, cantidad: 4, condicion: "BUENO" }],
      });
      expect((await inv.prestamo(prestamo.id)).status).toBe("PARCIAL");

      await inv.devolver({
        prestamoId: prestamo.id,
        detalles: [{ prestamoDetalleId: detalleId, cantidad: 6, condicion: "BUENO" }],
      });

      const cerrado = await inv.prestamo(prestamo.id);
      expect(cerrado.status).toBe("DEVUELTO");
      expect(cerrado.detalles[0]).toMatchObject({ cantidad: 10, devuelto: 10 });
      expect(cerrado.devoluciones).toHaveLength(2);
      expect(await inv.existencias(dispositivo.id)).toMatchObject({ DISPONIBLE: 15, PRESTADO: 0 });
    });

    test("cada condición de devolución manda la unidad al estado que le toca", async ({
      inv,
      escenario,
      departamentoId,
    }) => {
      const dispositivo = await escenario.dispositivo(10);
      const { prestamo } = await inv.prestar({
        departamentoId,
        detalles: [{ dispositivoId: dispositivo.id, cantidad: 8 }],
      });
      const detalleId = prestamo.detalles[0].id;

      await inv.devolver({
        prestamoId: prestamo.id,
        detalles: [
          { prestamoDetalleId: detalleId, cantidad: 3, condicion: "BUENO" },
          { prestamoDetalleId: detalleId, cantidad: 2, condicion: "ACEPTABLE" },
        ],
      });
      // BUENO y ACEPTABLE regresan al inventario disponible.
      expect(await inv.existencias(dispositivo.id)).toMatchObject({ DISPONIBLE: 7, PRESTADO: 3 });
      // Las dos líneas viajaron en la misma devolución: el devuelto las suma (§14).
      expect((await inv.prestamo(prestamo.id)).detalles[0]).toMatchObject({
        cantidad: 8,
        devuelto: 5,
      });

      await inv.devolver({
        prestamoId: prestamo.id,
        detalles: [{ prestamoDetalleId: detalleId, cantidad: 2, condicion: "MALO" }],
      });
      // MALO cuenta como dañado: sigue siendo existencia activa, pero no disponible.
      expect(await inv.existencias(dispositivo.id)).toMatchObject({
        DISPONIBLE: 7,
        PRESTADO: 1,
        DANADO: 2,
        activa: 10,
      });
    });

    test("la unidad devuelta como ROTO se da de baja automáticamente", async ({
      inv,
      escenario,
      departamentoId,
    }) => {
      const dispositivo = await escenario.dispositivo(10);
      const { prestamo } = await inv.prestar({
        departamentoId,
        detalles: [{ dispositivoId: dispositivo.id, cantidad: 4 }],
      });

      await inv.devolver({
        prestamoId: prestamo.id,
        detalles: [
          {
            prestamoDetalleId: prestamo.detalles[0].id,
            cantidad: 2,
            condicion: "ROTO",
            observaciones: "Pantalla destrozada",
          },
        ],
      });

      expect(await inv.existencias(dispositivo.id)).toMatchObject({
        DISPONIBLE: 6,
        PRESTADO: 2,
        BAJA: 2,
        activa: 8,
        historica: 10,
      });

      // Además del movimiento de DEVOLUCION queda la BAJA automática que lo respalda.
      const bajas = await inv.listarMovimientos({ dispositivoId: dispositivo.id, tipo: "BAJA" });
      expect(bajas).toHaveLength(1);
      expect(bajas[0].motivo).toBe("Baja automática por estado ROTO");
      expect(bajas[0].detalles.every((d) => d.condicion === "ROTO")).toBe(true);
    });

    test("rechaza devolver más de lo pendiente", async ({ inv, escenario, departamentoId }) => {
      const dispositivo = await escenario.dispositivo(10);
      const { prestamo } = await inv.prestar({
        departamentoId,
        detalles: [{ dispositivoId: dispositivo.id, cantidad: 5 }],
      });
      const detalleId = prestamo.detalles[0].id;
      await inv.devolver({
        prestamoId: prestamo.id,
        detalles: [{ prestamoDetalleId: detalleId, cantidad: 3, condicion: "BUENO" }],
      });

      const res = await inv.post("/inventario/devoluciones", {
        prestamoId: prestamo.id,
        detalles: [{ prestamoDetalleId: detalleId, cantidad: 5, condicion: "BUENO" }],
      });

      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({
        message: "La devolución excede el pendiente (2) del detalle",
      });
      expect(await inv.existencias(dispositivo.id)).toMatchObject({ DISPONIBLE: 8, PRESTADO: 2 });
    });

    test("rechaza devolver sobre un préstamo ya cerrado", async ({
      inv,
      escenario,
      departamentoId,
    }) => {
      const dispositivo = await escenario.dispositivo(4);
      const { prestamo } = await inv.prestar({
        departamentoId,
        detalles: [{ dispositivoId: dispositivo.id, cantidad: 2 }],
      });
      const detalleId = prestamo.detalles[0].id;
      await inv.devolver({
        prestamoId: prestamo.id,
        detalles: [{ prestamoDetalleId: detalleId, cantidad: 2, condicion: "BUENO" }],
      });

      const res = await inv.post("/inventario/devoluciones", {
        prestamoId: prestamo.id,
        detalles: [{ prestamoDetalleId: detalleId, cantidad: 1, condicion: "BUENO" }],
      });
      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({ message: "El préstamo ya está devuelto o cancelado" });
    });

    test("rechaza una devolución sin detalle de préstamo válido", async ({
      inv,
      escenario,
      departamentoId,
    }) => {
      const dispositivo = await escenario.dispositivo(4);
      const { prestamo } = await inv.prestar({
        departamentoId,
        detalles: [{ dispositivoId: dispositivo.id, cantidad: 2 }],
      });

      const ajeno = await inv.post("/inventario/devoluciones", {
        prestamoId: prestamo.id,
        detalles: [
          {
            prestamoDetalleId: "00000000-0000-0000-0000-000000000000",
            cantidad: 1,
            condicion: "BUENO",
          },
        ],
      });
      expect(ajeno.status).toBe(404);

      const sinCondicion = await inv.post("/inventario/devoluciones", {
        prestamoId: prestamo.id,
        detalles: [{ prestamoDetalleId: prestamo.detalles[0].id, cantidad: 1 }],
      });
      expect(sinCondicion.status).toBe(400);
      expect(sinCondicion.body).toMatchObject({ error: "ValidationError" });
    });
  });

  test.describe("cancelación y edición", () => {
    test("cancelar libera las unidades pendientes", async ({
      inv,
      escenario,
      departamentoId,
    }) => {
      const dispositivo = await escenario.dispositivo(10);
      const { prestamo } = await inv.prestar({
        departamentoId,
        detalles: [{ dispositivoId: dispositivo.id, cantidad: 6 }],
      });

      const cancelado = await inv.cancelarPrestamo(prestamo.id);
      expect(cancelado.status).toBe("CANCELADO");
      expect(await inv.existencias(dispositivo.id)).toMatchObject({ DISPONIBLE: 10, PRESTADO: 0 });

      const detalle = await db.prestamoDetalle.findFirstOrThrow({
        where: { prestamoId: prestamo.id },
      });
      expect(detalle.devuelto).toBe(detalle.cantidad);
    });

    test("cancelar respeta lo ya devuelto y no lo cuenta dos veces", async ({
      inv,
      escenario,
      departamentoId,
    }) => {
      const dispositivo = await escenario.dispositivo(10);
      const { prestamo } = await inv.prestar({
        departamentoId,
        detalles: [{ dispositivoId: dispositivo.id, cantidad: 6 }],
      });
      await inv.devolver({
        prestamoId: prestamo.id,
        detalles: [{ prestamoDetalleId: prestamo.detalles[0].id, cantidad: 2, condicion: "MALO" }],
      });

      await inv.cancelarPrestamo(prestamo.id);

      // Las 2 devueltas siguen dañadas; las 4 pendientes vuelven a disponibles.
      expect(await inv.existencias(dispositivo.id)).toMatchObject({
        DISPONIBLE: 8,
        DANADO: 2,
        PRESTADO: 0,
        activa: 10,
      });
    });

    test("no se puede cancelar dos veces", async ({ inv, escenario, departamentoId }) => {
      const dispositivo = await escenario.dispositivo(4);
      const { prestamo } = await inv.prestar({
        departamentoId,
        detalles: [{ dispositivoId: dispositivo.id, cantidad: 2 }],
      });
      await inv.cancelarPrestamo(prestamo.id);

      const res = await inv.post(`/inventario/prestamos/${prestamo.id}/cancelar`);
      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({ message: "El préstamo ya está devuelto o cancelado" });
    });

    test("editar la cantidad reasigna las unidades mientras no haya devoluciones", async ({
      inv,
      escenario,
      departamentoId,
    }) => {
      const dispositivo = await escenario.dispositivo(10);
      const { prestamo } = await inv.prestar({
        departamentoId,
        detalles: [{ dispositivoId: dispositivo.id, cantidad: 5 }],
      });

      const editado = await inv.actualizarPrestamo(prestamo.id, { cantidad: 3 });

      expect(editado.detalles[0].cantidad).toBe(3);
      expect(await inv.existencias(dispositivo.id)).toMatchObject({ DISPONIBLE: 7, PRESTADO: 3 });
      expect(
        await db.prestamoDetalleUnidad.count({ where: { prestamoDetalleId: prestamo.detalles[0].id } })
      ).toBe(3);
    });

    test("editar el recurso ya no se permite si hubo devoluciones", async ({
      inv,
      escenario,
      departamentoId,
    }) => {
      const dispositivo = await escenario.dispositivo(10);
      const { prestamo } = await inv.prestar({
        departamentoId,
        detalles: [{ dispositivoId: dispositivo.id, cantidad: 5 }],
      });
      await inv.devolver({
        prestamoId: prestamo.id,
        detalles: [{ prestamoDetalleId: prestamo.detalles[0].id, cantidad: 1, condicion: "BUENO" }],
      });

      const res = await inv.put(`/inventario/prestamos/${prestamo.id}`, { cantidad: 2 });
      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({
        message:
          "El préstamo ya tiene devoluciones; no se puede editar el recurso, solo la asignación",
      });

      // La asignación sí se puede seguir corrigiendo.
      const soloObservaciones = await inv.actualizarPrestamo(prestamo.id, {
        observaciones: "Corrección de captura",
      });
      expect(soloObservaciones.observaciones).toBe("Corrección de captura");
    });

    test("editar la cantidad hacia arriba valida que alcancen las existencias", async ({
      inv,
      escenario,
      departamentoId,
    }) => {
      const dispositivo = await escenario.dispositivo(6);
      const { prestamo } = await inv.prestar({
        departamentoId,
        detalles: [{ dispositivoId: dispositivo.id, cantidad: 4 }],
      });

      const res = await inv.put(`/inventario/prestamos/${prestamo.id}`, { cantidad: 9 });
      expect(res.status).toBe(409);
      expect(await inv.existencias(dispositivo.id)).toMatchObject({ DISPONIBLE: 2, PRESTADO: 4 });
    });
  });

  test("varios préstamos simultáneos nunca asignan la misma unidad dos veces", async ({
    inv,
    escenario,
    departamentoId,
  }) => {
    const dispositivo = await escenario.dispositivo(5);

    const respuestas = await Promise.all(
      Array.from({ length: 5 }, () =>
        inv.post("/inventario/prestamos", {
          departamentoId,
          detalles: [{ dispositivoId: dispositivo.id, cantidad: 1 }],
        })
      )
    );

    const exitosos = respuestas.filter((r) => r.status === 201).length;
    expect(exitosos).toBeGreaterThan(0);

    // Invariante duro: ninguna unidad puede estar ligada a dos préstamos y el
    // total de piezas se conserva, pase lo que pase con la concurrencia.
    const ligadas = await db.prestamoDetalleUnidad.findMany({
      where: { unidadFisica: { dispositivoId: dispositivo.id } },
      select: { unidadFisicaId: true },
    });
    expect(new Set(ligadas.map((l) => l.unidadFisicaId)).size).toBe(ligadas.length);

    const estados = await estadosEnBase(dispositivo.id);
    expect((estados.DISPONIBLE ?? 0) + (estados.PRESTADO ?? 0)).toBe(5);
    expect(estados.PRESTADO ?? 0).toBe(exitosos);
  });

  test("un EMPLEADO no puede prestar ni devolver", async ({
    inv,
    invEmpleado,
    escenario,
    departamentoId,
  }) => {
    const dispositivo = await escenario.dispositivo(4);
    const { prestamo } = await inv.prestar({
      departamentoId,
      detalles: [{ dispositivoId: dispositivo.id, cantidad: 2 }],
    });

    expect(
      (
        await invEmpleado.post("/inventario/prestamos", {
          departamentoId,
          detalles: [{ dispositivoId: dispositivo.id, cantidad: 1 }],
        })
      ).status
    ).toBe(403);

    expect(
      (
        await invEmpleado.post("/inventario/devoluciones", {
          prestamoId: prestamo.id,
          detalles: [{ prestamoDetalleId: prestamo.detalles[0].id, cantidad: 1, condicion: "BUENO" }],
        })
      ).status
    ).toBe(403);

    // Y el EMPLEADO sí puede consultar: la lectura no está restringida.
    expect((await invEmpleado.get("/inventario/prestamos")).status).toBe(200);
  });
});
