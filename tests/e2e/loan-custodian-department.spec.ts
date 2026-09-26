import { test, expect } from "./support/fixtures";
import { db } from "./support/db";
import { assertSafeDatabase } from "./support/env";
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
assertSafeDatabase();

const runId = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`.toUpperCase();
const PASSWORD = "E2E-RespDept-2026!";

interface LoanWithCustodian {
  id: string;
  custodianId: string | null;
  custodian: {
    id: string;
    name: string;
    username: string;
    employeeNumber: string | null;
    department: { id: string; name: string } | null;
  } | null;
}

interface Custodian {
  id: string;
  username: string;
  name: string;
}

const createCustodian = async (
  adminReq: APIRequestContext,
  input: { suffix: string; name: string; departmentId?: string }
): Promise<Custodian> => {
  const username = `e2e_respdept_${runId}_${input.suffix}`.toLowerCase();
  const res = await adminReq.post("users", {
    data: {
      username,
      password: PASSWORD,
      name: input.name,
      role: "EMPLOYEE",
      ...(input.departmentId ? { departmentId: input.departmentId } : {}),
    },
  });
  if (res.status() !== 201) {
    throw new Error(`No se pudo crear el responsable (${res.status()}): ${await res.text()}`);
  }
  const body = (await res.json()) as { id: string };
  return { id: body.id, username, name: input.name };
};

const clearCustodian = async (id: string): Promise<void> => {
  await db.auditLog.deleteMany({ where: { entityType: "User", entityId: id } });
  // Los préstamos/movimientos que lo referencian quedan con responsableId null
  // (relaciones opcionales); el teardown global recoge el inventario E2E.
  await db.user.delete({ where: { id } }).catch(() => {
    /* si quedara una referencia dura, el teardown global lo recoge */
  });
};

const firstDepartment = () => db.department.findFirst({ select: { id: true, name: true } });

test.describe("Préstamos — responsable.department (E2E)", () => {
  test("listPrestamos y getPrestamo exponen el departamento del responsable", async ({
    ctxAdmin,
    inv,
    scenario,
  }) => {
    const dept = await firstDepartment();
    if (!dept) {
      test.skip(true, "No hay departamentos en la base");
      return;
    }
    const custodian = await createCustodian(ctxAdmin, {
      suffix: "resp",
      name: `E2E Responsable ${runId}`,
      departmentId: dept.id,
    });
    try {
      const device = await scenario.device(3);
      const { loan } = await inv.lend({
        custodianId: custodian.id,
        items: [{ deviceId: device.id, quantity: 1 }],
      });

      const list = await inv.get<LoanWithCustodian[]>("/inventory/loans");
      expect(list.status).toBe(200);
      const inList = list.body.find((p) => p.id === loan.id);
      expect(inList?.custodian?.department).toMatchObject({ id: dept.id, name: dept.name });

      const item = await inv.get<LoanWithCustodian>(`/inventory/loans/${loan.id}`);
      expect(item.status).toBe(200);
      expect(item.body.custodian?.department).toMatchObject({ id: dept.id, name: dept.name });
    } finally {
      await clearCustodian(custodian.id);
    }
  });

  test("responsable sin departamento expone department null", async ({ ctxAdmin, inv, scenario }) => {
    const custodian = await createCustodian(ctxAdmin, {
      suffix: "nodeptresp",
      name: `E2E SinDeptoResp ${runId}`,
    });
    try {
      const device = await scenario.device(2);
      const { loan } = await inv.lend({
        custodianId: custodian.id,
        items: [{ deviceId: device.id, quantity: 1 }],
      });

      const item = await inv.get<LoanWithCustodian>(`/inventory/loans/${loan.id}`);
      expect(item.status).toBe(200);
      expect(item.body.custodian).not.toBeNull();
      expect(item.body.custodian?.department).toBeNull();
    } finally {
      await clearCustodian(custodian.id);
    }
  });

  test("PUT /inventario/prestamos/:id devuelve responsable.department", async ({
    ctxAdmin,
    inv,
    scenario,
  }) => {
    const dept = await firstDepartment();
    if (!dept) {
      test.skip(true, "No hay departamentos en la base");
      return;
    }
    const custodian = await createCustodian(ctxAdmin, {
      suffix: "put",
      name: `E2E PutResp ${runId}`,
      departmentId: dept.id,
    });
    try {
      const device = await scenario.device(2);
      const { loan } = await inv.lend({
        custodianId: custodian.id,
        items: [{ deviceId: device.id, quantity: 1 }],
      });

      const updated = await inv.put<LoanWithCustodian>(
        `/inventory/loans/${loan.id}`,
        { notes: "editado e2e" }
      );
      expect(updated.status).toBe(200);
      expect(updated.body.custodian?.department).toMatchObject({ id: dept.id, name: dept.name });
    } finally {
      await clearCustodian(custodian.id);
    }
  });
});
