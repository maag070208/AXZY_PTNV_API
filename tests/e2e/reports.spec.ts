import { test, expect } from "./support/fixtures";
import { db } from "./support/db";
import { E2E } from "./support/env";

/**
 * REPORTE de dispositivos — `/reports/devices` y `/reports/asignados`.
 *
 * La web condiciona responsable/depto/días/folio a `estado === "ASIGNADO"`,
 * pero el inventario guarda la unidad como `PRESTADO`. El service normaliza
 * `PRESTADO → ASIGNADO`; aquí se verifica que el reporte salga ya normalizado
 * y con los campos de asignación poblados.
 */

interface DeviceReportRow {
  deviceId: string;
  assetTag: string;
  description: string;
  type: string;
  brand: string;
  model: string;
  status: string;
  custodian: string | null;
  employeeNumber: string | null;
  department: string | null;
  daysAssigned: number | null;
  folio: string | null;
}

interface AssignedDeviceRow {
  deviceId: string;
  assetTag: string;
  description: string;
  custodian: string;
  department: string | null;
  daysAssigned: number | null;
  folio: string | null;
}

const msPerDay = 1000 * 60 * 60 * 24;

test.describe("REPORTES — dispositivos", () => {
  test("el reporte de devices normaliza PRESTADO→ASIGNADO y puebla los campos", async ({
    inv,
    scenario,
    departmentId,
  }) => {
    // Unidad de control: sigue DISPONIBLE, sus campos de asignación van null.
    const availableDevice = await scenario.device(1);
    const [availableUnit] = await inv.units(availableDevice.id);

    // Unidad prestada con responsable + departamento.
    const loanedDevice = await scenario.device(1);
    const [loanedUnit] = await inv.units(loanedDevice.id);
    const admin = await db.user.findUniqueOrThrow({
      where: { username: E2E.admin.username },
    });
    const dept = await db.department.findUniqueOrThrow({
      where: { id: departmentId },
    });

    const { loan } = await inv.lend({
      custodianId: admin.id,
      departmentId,
      items: [{ deviceId: loanedDevice.id, quantity: 1 }],
    });

    // Envejecemos el préstamo para que los días reportados sean estables y
    // superen el umbral de alerta (>30) sin depender del reloj.
    await db.loan.update({
      where: { id: loan.id },
      data: { date: new Date(Date.now() - 40 * msPerDay) },
    });

    const res = await inv.get<{ data: DeviceReportRow[]; total: number }>("/reports/devices");
    expect(res.status).toBe(200);

    const loaned = res.body.data.find((r) => r.assetTag === loanedUnit.assetTag);
    expect(loaned).toBeDefined();
    expect(loaned).toMatchObject({
      status: "ASSIGNED",
      custodian: admin.name,
      department: dept.name,
      folio: loan.number,
    });
    expect(loaned!.employeeNumber).toBe(admin.employeeNumber);
    expect(loaned!.daysAssigned).toBeGreaterThanOrEqual(40);

    // Caso negativo: la unidad disponible no trae asignación.
    const available = res.body.data.find((r) => r.assetTag === availableUnit.assetTag);
    expect(available).toBeDefined();
    expect(available).toMatchObject({
      status: "AVAILABLE",
      custodian: null,
      department: null,
      folio: null,
      daysAssigned: null,
    });
  });

  test("/reports/asignados lista la misma unidad con responsable, depto y folio", async ({
    inv,
    scenario,
    departmentId,
  }) => {
    const device = await scenario.device(1);
    const [unit] = await inv.units(device.id);
    const admin = await db.user.findUniqueOrThrow({
      where: { username: E2E.admin.username },
    });
    const dept = await db.department.findUniqueOrThrow({
      where: { id: departmentId },
    });

    const { loan } = await inv.lend({
      custodianId: admin.id,
      departmentId,
      items: [{ deviceId: device.id, quantity: 1 }],
    });

    const res = await inv.get<{ data: AssignedDeviceRow[]; total: number }>("/reports/assigned-devices");
    expect(res.status).toBe(200);

    const row = res.body.data.find((r) => r.assetTag === unit.assetTag);
    expect(row).toBeDefined();
    expect(row).toMatchObject({
      custodian: admin.name,
      department: dept.name,
      folio: loan.number,
    });
    expect(row!.daysAssigned).toBeGreaterThanOrEqual(0);
  });

  test("sin token, el reporte responde 401", async ({ invAnonymous }) => {
    expect((await invAnonymous.get("/reports/devices")).status).toBe(401);
    expect((await invAnonymous.get("/reports/assigned-devices")).status).toBe(401);
  });
});