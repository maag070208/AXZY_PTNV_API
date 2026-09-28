import { test, expect } from "./support/fixtures";
import { db } from "./support/db";
import { E2E_PREFIX, newRunId } from "./support/env";
import type { Unit } from "./support/inventory-api";

/**
 * EDICIÓN DE UNIDAD — BLINDAJE.md §3, §5.
 *
 * `PUT /inventory/units/:id` edita la identificación de la pieza (serie, MAC,
 * IP, hostname, área). El departamento NO se cambia aquí: para eso está el
 * traspaso, que pasa por el kardex y la bitácora.
 */
const RUN = newRunId();

test.afterAll(async () => {
  // La bitácora de unidades no la recoge el teardown global; se limpia aquí.
  const units = await db.deviceUnit.findMany({
    where: { device: { type: { code: { startsWith: E2E_PREFIX } } } },
    select: { id: true },
  });
  await db.auditLog.deleteMany({
    where: { action: "DEVICE_UNIT_UPDATED", entityId: { in: units.map((u) => u.id) } },
  });
});

test.describe("EDICIÓN de unidad (E2E)", () => {
  test("edita serie, MAC, IP, hostname y área; normaliza la serie", async ({ inv, scenario }) => {
    const device = await scenario.device(2);
    const unit = (await inv.units(device.id))[0];

    const updated = await inv.updateUnit(unit.id, {
      serialNumber: `  SN-${RUN}-1  `,
      macAddress: `02:00:00:${RUN.slice(-2)}:00:01`,
      ip: "10.9.9.9",
      hostname: `PC-${RUN}`,
      area: "ALMACEN",
    });

    expect(updated).toMatchObject({
      serialNumber: `SN-${RUN}-1`,
      ip: "10.9.9.9",
      hostname: `PC-${RUN}`,
      area: "ALMACEN",
    });
  });

  test("un id inexistente es 404", async ({ inv }) => {
    const res = await inv.put("/inventory/units/00000000-0000-0000-0000-000000000000", {
      ip: "10.0.0.1",
    });
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ code: "UNIT_NOT_FOUND" });
  });

  test("un EMPLEADO no puede editar unidades", async ({ invEmployee, inv, scenario }) => {
    const device = await scenario.device(1);
    const unit = (await inv.units(device.id))[0];

    const res = await invEmployee.put(`/inventory/units/${unit.id}`, { ip: "10.0.0.2" });
    expect(res.status).toBe(403);
  });

  test("el departamento no se cambia por esta vía", async ({ inv, scenario, departmentId }) => {
    const device = await scenario.device(1);
    const unit = (await inv.units(device.id))[0];
    expect(unit.departmentId).toBeNull();

    const res = await inv.put<Unit>(`/inventory/units/${unit.id}`, {
      hostname: `H-${RUN}`,
      departmentId,
    });
    expect(res.status).toBe(200);
    expect(res.body.departmentId).toBeNull();

    const inDb = await db.deviceUnit.findUniqueOrThrow({ where: { id: unit.id } });
    expect(inDb.departmentId).toBeNull();
    expect(inDb.hostname).toBe(`H-${RUN}`);
  });

  test("rechaza una serie repetida (trim y mayúsculas) con 409", async ({ inv, scenario }) => {
    const a = await inv.createDevice({
      typeId: scenario.type.id,
      name: `Serial A ${RUN}`,
      brand: "M",
      model: "X",
      units: [{ serialNumber: `SN-DUP-${RUN}` }],
    });
    const b = await inv.createDevice({
      typeId: scenario.type.id,
      name: `Serial B ${RUN}`,
      brand: "M",
      model: "X",
      units: [{ serialNumber: `SN-B-${RUN}` }],
    });
    const unitA = (await inv.units(a.id))[0];
    const unitB = (await inv.units(b.id))[0];

    const res = await inv.put(`/inventory/units/${unitB.id}`, {
      serialNumber: `  sn-dup-${RUN}  `,
    });

    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ code: "SERIAL_NUMBER_TAKEN" });
    expect((res.body as { message: string }).message).toContain(unitA.assetTag);

    // La unidad intentada conserva su serie original.
    expect((await inv.units(b.id))[0].serialNumber).toBe(`SN-B-${RUN}`);
  });

  test("el cambio queda en la bitácora como DEVICE_UNIT_UPDATED", async ({ inv, scenario }) => {
    const device = await scenario.device(1);
    const unit = (await inv.units(device.id))[0];

    await inv.updateUnit(unit.id, { ip: "10.1.2.3" });

    const log = await db.auditLog.findFirst({
      where: { action: "DEVICE_UNIT_UPDATED", entityType: "DeviceUnit", entityId: unit.id },
      orderBy: { createdAt: "desc" },
    });
    expect(log).not.toBeNull();
    expect(log?.newState).toMatchObject({ ip: "10.1.2.3" });
    expect(log?.previousState).toMatchObject({ ip: null });
  });
});
