import { test, expect } from "./support/fixtures";
import { db } from "./support/db";
import { assertBaseDeDatosSegura } from "./support/env";
import type { APIRequestContext } from "@playwright/test";

/**
 * E2E — `responsable.department` en préstamos.
 *
 * Cubre el requerimiento "en la carta el Área sale del departamento del
 * responsable; si no tiene, cae a Sistemas": la API debe exponer el
 * departamento del responsable en el listado, en el detalle y en la respuesta
 * de actualización, para que la web pueda resolver el Área.
 *
 * Se ejecuta contra la base real. Cada test crea su propio responsable vía
 * `POST /users` y lo borra al final (mismo patrón que `user-baja.spec.ts`).
 */
assertBaseDeDatosSegura();

const runId = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`.toUpperCase();
const PASSWORD = "E2E-RespDept-2026!";

interface PrestamoConResponsable {
  id: string;
  responsableId: string | null;
  responsable: {
    id: string;
    name: string;
    username: string;
    numeroEmpleado: string | null;
    department: { id: string; name: string } | null;
  } | null;
}

interface Responsable {
  id: string;
  username: string;
  name: string;
}

const crearResponsable = async (
  adminReq: APIRequestContext,
  input: { suffix: string; name: string; departmentId?: string }
): Promise<Responsable> => {
  const username = `e2e_respdept_${runId}_${input.suffix}`.toLowerCase();
  const res = await adminReq.post("users", {
    data: {
      username,
      password: PASSWORD,
      name: input.name,
      role: "EMPLEADO",
      ...(input.departmentId ? { departmentId: input.departmentId } : {}),
    },
  });
  if (res.status() !== 201) {
    throw new Error(`No se pudo crear el responsable (${res.status()}): ${await res.text()}`);
  }
  const body = (await res.json()) as { id: string };
  return { id: body.id, username, name: input.name };
};

const limpiarResponsable = async (id: string): Promise<void> => {
  await db.auditLog.deleteMany({ where: { entityType: "User", entityId: id } });
  // Los préstamos/movimientos que lo referencian quedan con responsableId null
  // (relaciones opcionales); el teardown global recoge el inventario E2E.
  await db.user.delete({ where: { id } }).catch(() => {
    /* si quedara una referencia dura, el teardown global lo recoge */
  });
};

const primerDepartamento = () => db.department.findFirst({ select: { id: true, name: true } });

test.describe("Préstamos — responsable.department (E2E)", () => {
  test("listPrestamos y getPrestamo exponen el departamento del responsable", async ({
    ctxAdmin,
    inv,
    escenario,
  }) => {
    const depto = await primerDepartamento();
    if (!depto) {
      test.skip(true, "No hay departamentos en la base");
      return;
    }
    const responsable = await crearResponsable(ctxAdmin, {
      suffix: "resp",
      name: `E2E Responsable ${runId}`,
      departmentId: depto.id,
    });
    try {
      const dispositivo = await escenario.dispositivo(3);
      const { prestamo } = await inv.prestar({
        responsableId: responsable.id,
        detalles: [{ dispositivoId: dispositivo.id, cantidad: 1 }],
      });

      const lista = await inv.get<PrestamoConResponsable[]>("/inventario/prestamos");
      expect(lista.status).toBe(200);
      const enLista = lista.body.find((p) => p.id === prestamo.id);
      expect(enLista?.responsable?.department).toMatchObject({ id: depto.id, name: depto.name });

      const detalle = await inv.get<PrestamoConResponsable>(`/inventario/prestamos/${prestamo.id}`);
      expect(detalle.status).toBe(200);
      expect(detalle.body.responsable?.department).toMatchObject({ id: depto.id, name: depto.name });
    } finally {
      await limpiarResponsable(responsable.id);
    }
  });

  test("responsable sin departamento expone department null", async ({ ctxAdmin, inv, escenario }) => {
    const responsable = await crearResponsable(ctxAdmin, {
      suffix: "nodeptresp",
      name: `E2E SinDeptoResp ${runId}`,
    });
    try {
      const dispositivo = await escenario.dispositivo(2);
      const { prestamo } = await inv.prestar({
        responsableId: responsable.id,
        detalles: [{ dispositivoId: dispositivo.id, cantidad: 1 }],
      });

      const detalle = await inv.get<PrestamoConResponsable>(`/inventario/prestamos/${prestamo.id}`);
      expect(detalle.status).toBe(200);
      expect(detalle.body.responsable).not.toBeNull();
      expect(detalle.body.responsable?.department).toBeNull();
    } finally {
      await limpiarResponsable(responsable.id);
    }
  });

  test("PUT /inventario/prestamos/:id devuelve responsable.department", async ({
    ctxAdmin,
    inv,
    escenario,
  }) => {
    const depto = await primerDepartamento();
    if (!depto) {
      test.skip(true, "No hay departamentos en la base");
      return;
    }
    const responsable = await crearResponsable(ctxAdmin, {
      suffix: "put",
      name: `E2E PutResp ${runId}`,
      departmentId: depto.id,
    });
    try {
      const dispositivo = await escenario.dispositivo(2);
      const { prestamo } = await inv.prestar({
        responsableId: responsable.id,
        detalles: [{ dispositivoId: dispositivo.id, cantidad: 1 }],
      });

      const actualizado = await inv.put<PrestamoConResponsable>(
        `/inventario/prestamos/${prestamo.id}`,
        { observaciones: "editado e2e" }
      );
      expect(actualizado.status).toBe(200);
      expect(actualizado.body.responsable?.department).toMatchObject({ id: depto.id, name: depto.name });
    } finally {
      await limpiarResponsable(responsable.id);
    }
  });
});
