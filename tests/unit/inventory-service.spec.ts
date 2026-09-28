import { test, expect } from "@playwright/test";
import { HttpError } from "../../src/core/middlewares/error.middleware";
import type { AuditLogInput, AuditPort } from "../../src/modules/audit/models/entity/audit.entity";
import { InventoryService } from "../../src/modules/inventory/services/inventory.service";
import * as ably from "../../src/core/services/ably";

/**
 * Pruebas unitarias del servicio de inventario para los movimientos que NO se
 * exponen por HTTP: `TRANSFER`, `ADJUSTMENT_IN` y `ADJUSTMENT_OUT`. Sin BD: se
 * inyecta un doble de Prisma y un puerto de auditoría en memoria.
 *
 * Cubre que el traspaso use el candado optimista y registre las unidades
 * exactas, y que los ajustes de alta/baja también dejen sus `movement_item_units`.
 */

// `broadcastDashboardEvent` intenta publicar en Ably; en unit tests es un no-op.
(ably as unknown as Record<string, unknown>).broadcastDashboardEvent = async () => {};

interface UnitRow {
  id: string;
  deviceId: string;
  assetTag: string;
  status: string;
  departmentId: string | null;
}

interface DeviceRow {
  id: string;
  typeId: string;
}

interface MovementRow {
  id: string;
  type: string;
  createdById?: string;
  reason?: string | null;
  notes?: string | null;
  departmentId?: string | null;
  items: Array<Record<string, any>>;
}

const unit = (id: string, assetTag: string, status = "AVAILABLE"): UnitRow => ({
  id,
  deviceId: "dev-1",
  assetTag,
  status,
  departmentId: null,
});

const makeHarness = (opts: { units?: UnitRow[]; lockMismatch?: boolean } = {}) => {
  const units: UnitRow[] = (opts.units ?? []).map((u) => ({ ...u }));
  const movements: MovementRow[] = [];
  const device: DeviceRow = { id: "dev-1", typeId: "type-1" };
  const type = { id: "type-1", assetTagPrefix: "ACT", counter: 0 };
  let newUnitSeq = units.length;

  const tx: any = {
    device: {
      findUnique: async ({ where }: any) => (where.id === device.id ? { ...device } : null),
    },
    deviceType: {
      findUnique: async ({ where }: any) => (where.id === type.id ? { ...type } : null),
      update: async ({ data }: any) => {
        if (data.counter !== undefined) type.counter = data.counter;
        return { ...type };
      },
    },
    deviceUnit: {
      findMany: async ({ where, take }: any = {}) => {
        let rows = units.filter(
          (u) =>
            (!where?.id?.in || where.id.in.includes(u.id)) &&
            (!where?.deviceId || u.deviceId === where.deviceId) &&
            (!where?.status || u.status === where.status)
        );
        if (take !== undefined) rows = rows.slice(0, take);
        return rows.map((u) => ({ ...u }));
      },
      updateMany: async ({ where, data }: any) => {
        const targets = units.filter(
          (u) => where.id.in.includes(u.id) && (where.status === undefined || u.status === where.status)
        );
        for (const u of targets) Object.assign(u, data);
        return { count: opts.lockMismatch ? Math.max(targets.length - 1, 0) : targets.length };
      },
      create: async ({ data }: any) => {
        const row: UnitRow = { id: `u-new-${newUnitSeq++}`, status: "AVAILABLE", departmentId: null, ...data };
        units.push(row);
        return { ...row };
      },
    },
    movement: {
      create: async ({ data }: any) => {
        const row: MovementRow = {
          id: `m-${movements.length + 1}`,
          ...data,
          items: (data.items?.create ?? []) as Array<Record<string, any>>,
        };
        movements.push(row);
        return row;
      },
      update: async ({ where, data }: any) => {
        const row = movements.find((m) => m.id === where.id);
        return row ? { ...row, ...data } : null;
      },
    },
  };

  const logs: AuditLogInput[] = [];
  const auditPort: AuditPort = {
    createLog: async (input) => {
      logs.push(input);
      return input;
    },
  };
  const prisma = { $transaction: async (fn: any) => fn(tx) } as any;

  return { service: new InventoryService(auditPort, prisma), units, movements, type, logs };
};

const captureAsync = async (fn: () => Promise<unknown>): Promise<HttpError | null> => {
  try {
    await fn();
    return null;
  } catch (e) {
    return e as HttpError;
  }
};

const unitIdsOf = (movement: MovementRow): string[] => {
  const item = movement.items[0] as any;
  return (item.units?.create ?? []).map((c: any) => c.deviceUnitId);
};

test.describe("InventoryService — TRANSFER", () => {
  test("mueve las unidades exactas y las registra en el movimiento", async () => {
    const { service, units, movements } = makeHarness({
      units: [unit("u1", "A-0001"), unit("u2", "A-0002"), unit("u3", "A-0003")],
    });

    const movement = await (service.registerMovement(
      {
        type: "TRANSFER",
        departmentId: "dept-1",
        items: [{ deviceId: "dev-1", quantity: 2, unitIds: ["u1", "u3"] }],
      },
      "user-1"
    ) as Promise<MovementRow>);

    expect(movement.type).toBe("TRANSFER");
    expect(units.find((u) => u.id === "u1")?.departmentId).toBe("dept-1");
    expect(units.find((u) => u.id === "u3")?.departmentId).toBe("dept-1");
    expect(units.find((u) => u.id === "u2")?.departmentId).toBeNull();
    expect(unitIdsOf(movements[0])).toEqual(["u1", "u3"]);
    expect((movements[0].items[0] as any).quantity).toBe(2);
  });

  test("sin departamento es 400", async () => {
    const { service } = makeHarness({ units: [unit("u1", "A-0001")] });
    const err = await captureAsync(() =>
      service.registerMovement(
        { type: "TRANSFER", items: [{ deviceId: "dev-1", quantity: 1 }] },
        "user-1"
      )
    );
    expect(err?.status).toBe(400);
    expect(err?.code).toBe("DEPARTMENT_REQUIRED");
  });

  test("sin unidades suficientes es 409", async () => {
    const { service } = makeHarness({ units: [unit("u1", "A-0001")] });
    const err = await captureAsync(() =>
      service.registerMovement(
        { type: "TRANSFER", departmentId: "dept-1", items: [{ deviceId: "dev-1", quantity: 3 }] },
        "user-1"
      )
    );
    expect(err?.status).toBe(409);
    expect(err?.code).toBe("NOT_ENOUGH_UNITS_FOR_DEVICE");
  });

  test("si una unidad cambió de estado el candado aborta con 409", async () => {
    const { service } = makeHarness({
      units: [unit("u1", "A-0001"), unit("u2", "A-0002")],
      lockMismatch: true,
    });
    const err = await captureAsync(() =>
      service.registerMovement(
        {
          type: "TRANSFER",
          departmentId: "dept-1",
          items: [{ deviceId: "dev-1", quantity: 2, unitIds: ["u1", "u2"] }],
        },
        "user-1"
      )
    );
    expect(err?.status).toBe(409);
    expect(err?.code).toBe("UNITS_CHANGED");
  });
});

test.describe("InventoryService — ADJUSTMENT", () => {
  test("ADJUSTMENT_IN crea las unidades y las registra", async () => {
    const { service, units, movements } = makeHarness();

    await service.registerMovement(
      { type: "ADJUSTMENT_IN", items: [{ deviceId: "dev-1", quantity: 3 }] },
      "user-1"
    );

    expect(units).toHaveLength(3);
    expect(units.map((u) => u.assetTag)).toEqual(["ACT-0001", "ACT-0002", "ACT-0003"]);
    expect(units.every((u) => u.status === "AVAILABLE")).toBe(true);
    expect(unitIdsOf(movements[0])).toHaveLength(3);
    expect((movements[0].items[0] as any).quantity).toBe(3);
  });

  test("ADJUSTMENT_OUT retira disponibles y registra las unidades", async () => {
    const { service, units, movements } = makeHarness({
      units: [unit("u1", "A-0001"), unit("u2", "A-0002"), unit("u3", "A-0003")],
    });

    await service.registerMovement(
      { type: "ADJUSTMENT_OUT", reason: "Ajuste de conteo", items: [{ deviceId: "dev-1", quantity: 2 }] },
      "user-1"
    );

    expect(units.filter((u) => u.status === "RETIRED")).toHaveLength(2);
    expect(units.filter((u) => u.status === "AVAILABLE")).toHaveLength(1);
    expect(unitIdsOf(movements[0])).toHaveLength(2);
  });

  test("MAINTENANCE_IN con unitIds registra exactamente esas unidades", async () => {
    const { service, units, movements } = makeHarness({
      units: [unit("u1", "A-0001"), unit("u2", "A-0002"), unit("u3", "A-0003")],
    });

    await service.registerMovement(
      { type: "MAINTENANCE_IN", items: [{ deviceId: "dev-1", quantity: 2, unitIds: ["u2", "u3"] }] },
      "user-1"
    );

    expect(units.find((u) => u.id === "u2")?.status).toBe("IN_MAINTENANCE");
    expect(units.find((u) => u.id === "u3")?.status).toBe("IN_MAINTENANCE");
    expect(units.find((u) => u.id === "u1")?.status).toBe("AVAILABLE");
    expect(unitIdsOf(movements[0])).toEqual(["u2", "u3"]);
  });
});
