import type { APIRequestContext } from "@playwright/test";
import { request as playwrightRequest } from "@playwright/test";
import type { Role } from "@prisma/client";
import bcrypt from "bcryptjs";
import { test, expect } from "./support/fixtures";
import { db } from "./support/db";
import { E2E, E2E_PREFIX, assertSafeDatabase, newRunId } from "./support/env";

/**
 * E2E de contrato — aprobación de tiempo extra (`/overtime`).
 *
 * El tiempo extra se calcula con las CHECADAS del reloj (no con la bitácora del
 * guardia). Aquí se siembran a mano el horario, la asignación, el vínculo
 * reloj ↔ usuario y las checadas bajo una serie propia `E2E-OT-<run>`; todo se
 * borra al final por prefijo. Las consultas se aíslan por un departamento propio.
 */
assertSafeDatabase();

const RUN = newRunId();
const SERIAL = `${E2E_PREFIX}-OT-${RUN}`;
const DEPT_NAME = `E2E OT Depto ${RUN}`;
const SCHEDULE_MAIN = `E2E OT Horario ${RUN}`;
const SCHEDULE_REST = `E2E OT Descanso ${RUN}`;
const SCHEDULE_SNAP = `E2E OT Snapshot ${RUN}`;
const SCHEDULE_MIN60 = `E2E OT Min60 ${RUN}`;
const SCHEDULE_MIN60_REST = `E2E OT Min60 Rest ${RUN}`;
const SCHEDULE_MIN0 = `E2E OT Min0 ${RUN}`;
const DATE = "2026-03-10"; // martes
const DATE2 = "2026-03-17"; // martes
const DATE3 = "2026-03-18"; // miércoles
const TZ = "UTC";

let serial = 0;
let deptId = "";
let scheduleMainId = "";
let scheduleRestId = "";
let scheduleSnapId = "";
let scheduleMin60Id = "";
let scheduleMin60RestId = "";
let scheduleMin0Id = "";

const userIds: string[] = [];
const numbers: string[] = [];
const contexts: APIRequestContext[] = [];

interface Person {
  id: string;
  name: string;
  number: string;
}

const createUser = async (suffix: string, role: Role = "EMPLOYEE"): Promise<Person> => {
  const name = `E2E OT ${RUN} ${suffix}`;
  const user = await db.user.create({
    data: {
      username: `e2e_overtime_${RUN}_${suffix}`.toLowerCase(),
      name,
      role,
      active: true,
      departmentId: deptId,
      password: await bcrypt.hash(E2E.password, 10),
    },
    select: { id: true, name: true },
  });
  userIds.push(user.id);
  const number = `${E2E_PREFIX}${RUN}${suffix}`;
  numbers.push(number);
  return { id: user.id, name: user.name, number };
};

const linkEmployee = async (p: Person): Promise<void> => {
  await db.timeClockEmployee.create({ data: { employeeNumber: p.number, userId: p.id } });
};

const assign = async (p: Person, scheduleId: string): Promise<void> => {
  await db.scheduleAssignment.create({
    data: { userId: p.id, scheduleId, validFrom: new Date("2026-03-01T00:00:00.000Z") },
  });
};

const punch = async (number: string, occurredAt: string): Promise<void> => {
  await db.timeClockPunch.create({
    data: {
      clockSerial: SERIAL,
      serialNo: ++serial,
      employeeNumber: number,
      name: `E2E OT Checada ${RUN} ${number}`,
      method: "FACE",
      minor: 75,
      occurredAt: new Date(occurredAt),
    },
  });
};

const createSchedule = async (
  name: string,
  restWeekday?: number,
  minOvertimeMin = 0
): Promise<string> => {
  const schedule = await db.schedule.create({
    data: {
      name,
      exitToleranceMin: 0,
      mealBreakMin: 0,
      minOvertimeMin,
      days: {
        create: [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({
          weekday,
          restDay: weekday === restWeekday,
          startTime: weekday === restWeekday ? null : "08:00",
          endTime: weekday === restWeekday ? null : "17:00",
        })),
      },
    },
    select: { id: true },
  });
  return schedule.id;
};

const contextFor = async (username: string): Promise<APIRequestContext> => {
  const login = await playwrightRequest.newContext({ baseURL: E2E.baseURL });
  const res = await login.post("auth/login", { data: { username, password: E2E.password } });
  if (res.status() !== 200) {
    throw new Error(`No se pudo autenticar a "${username}" (${res.status()}): ${await res.text()}`);
  }
  const { token } = (await res.json()) as { token: string };
  await login.dispose();
  const ctx = await playwrightRequest.newContext({
    baseURL: E2E.baseURL,
    extraHTTPHeaders: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
  });
  contexts.push(ctx);
  return ctx;
};

interface OvertimeRow {
  userId: string;
  date: string;
  extraMin: number;
  status: string;
  approvedExtraMin: number;
  withoutSchedule: boolean;
  restDay: boolean;
  decidedByName: string | null;
}

interface OvertimeResponse {
  data: OvertimeRow[];
  total: number;
  summary: {
    pendingMinutes: number;
    approvedMinutes: number;
    rejectedMinutes: number;
    peopleWithPending: number;
  };
}

const queryOvertimeOn = async (ctx: APIRequestContext, date: string): Promise<OvertimeResponse> => {
  const res = await ctx.post("overtime/query", {
    data: {
      page: 1,
      limit: 100,
      filters: { period: "DAY", date, tz: TZ, departmentId: deptId },
    },
  });
  expect(res.status(), await res.text()).toBe(200);
  return (await res.json()) as OvertimeResponse;
};

const queryOvertime = (ctx: APIRequestContext): Promise<OvertimeResponse> =>
  queryOvertimeOn(ctx, DATE);

const findRow = (body: OvertimeResponse, userId: string): OvertimeRow | undefined =>
  body.data.find((r) => r.userId === userId);

let personA: Person;
let personRest: Person;
let personSnap: Person;
let personWithoutSchedule: Person;
let personUnlinked: Person;
let personAccessOnly: Person;
let personBelow: Person;
let personAbove: Person;
let personExact: Person;
let personBelow59: Person;
let personRestShort: Person;
let personRestLong: Person;
let personZero: Person;
let personMulti: Person;

test.beforeAll(async () => {
  const dept = await db.department.create({ data: { name: DEPT_NAME } });
  deptId = dept.id;

  scheduleMainId = await createSchedule(SCHEDULE_MAIN);
  scheduleRestId = await createSchedule(SCHEDULE_REST, 2); // martes de descanso
  scheduleSnapId = await createSchedule(SCHEDULE_SNAP);
  // Horarios con umbral de extra (minutos) para los casos de mínimo.
  scheduleMin60Id = await createSchedule(SCHEDULE_MIN60, undefined, 60);
  scheduleMin60RestId = await createSchedule(SCHEDULE_MIN60_REST, 2, 60); // martes de descanso
  scheduleMin0Id = await createSchedule(SCHEDULE_MIN0, undefined, 0);

  personA = await createUser("A");
  personRest = await createUser("R");
  personSnap = await createUser("S");
  personWithoutSchedule = await createUser("N");
  personUnlinked = await createUser("U");
  personAccessOnly = await createUser("X");
  personBelow = await createUser("B");
  personAbove = await createUser("C");
  personExact = await createUser("D");
  personBelow59 = await createUser("E");
  personRestShort = await createUser("F");
  personRestLong = await createUser("G");
  personZero = await createUser("H");
  personMulti = await createUser("I");

  for (const p of [
    personA,
    personRest,
    personSnap,
    personWithoutSchedule,
    personAccessOnly,
    personBelow,
    personAbove,
    personExact,
    personBelow59,
    personRestShort,
    personRestLong,
    personZero,
    personMulti,
  ]) {
    await linkEmployee(p);
  }
  // personaUnlinked queda SIN vínculo a propósito.

  await assign(personA, scheduleMainId);
  await assign(personRest, scheduleRestId);
  await assign(personSnap, scheduleSnapId);
  await assign(personAccessOnly, scheduleMainId);
  // personaSinHorario no tiene asignación a propósito.

  // Casos de mínimo de extra: horario normal 08:00-17:00 con umbral 60.
  await assign(personBelow, scheduleMin60Id);
  await assign(personAbove, scheduleMin60Id);
  await assign(personExact, scheduleMin60Id);
  await assign(personBelow59, scheduleMin60Id);
  await assign(personMulti, scheduleMin60Id);
  // Día de descanso (martes) con el mismo umbral 60.
  await assign(personRestShort, scheduleMin60RestId);
  await assign(personRestLong, scheduleMin60RestId);
  // Umbral 0 = sin mínimo.
  await assign(personZero, scheduleMin0Id);

  // A: 08:00 → 19:00 → 120 min extra (salida programada 17:00).
  await punch(personA.number, "2026-03-10T08:00:00Z");
  await punch(personA.number, "2026-03-10T19:00:00Z");
  // Descanso: 08:00 → 12:00, todo lo trabajado cuenta (240).
  await punch(personRest.number, "2026-03-10T08:00:00Z");
  await punch(personRest.number, "2026-03-10T12:00:00Z");
  // Snapshot: 08:00 → 19:00 → 120 min extra.
  await punch(personSnap.number, "2026-03-10T08:00:00Z");
  await punch(personSnap.number, "2026-03-10T19:00:00Z");
  // Sin horario y sin vínculo: checan igual.
  await punch(personWithoutSchedule.number, "2026-03-10T08:00:00Z");
  await punch(personWithoutSchedule.number, "2026-03-10T19:00:00Z");
  await punch(personUnlinked.number, "2026-03-10T08:00:00Z");
  await punch(personUnlinked.number, "2026-03-10T19:00:00Z");

  // Umbral 60 (normal): 45 min < mínimo → 0; 89 ≥ mínimo → 89 (minutos exactos).
  await punch(personBelow.number, "2026-03-17T08:00:00Z");
  await punch(personBelow.number, "2026-03-17T17:45:00Z"); // 45 → 0
  await punch(personAbove.number, "2026-03-17T08:00:00Z");
  await punch(personAbove.number, "2026-03-17T18:29:00Z"); // 89
  // Borde `>=`: 60 exactos cuentan; 59 no.
  await punch(personExact.number, "2026-03-17T08:00:00Z");
  await punch(personExact.number, "2026-03-17T18:00:00Z"); // 60
  await punch(personBelow59.number, "2026-03-17T08:00:00Z");
  await punch(personBelow59.number, "2026-03-17T17:59:00Z"); // 59 → 0
  // Día de descanso con umbral: 30 < 60 → 0; 90 ≥ 60 → 90.
  await punch(personRestShort.number, "2026-03-17T08:00:00Z");
  await punch(personRestShort.number, "2026-03-17T08:30:00Z"); // 30 → 0
  await punch(personRestLong.number, "2026-03-17T08:00:00Z");
  await punch(personRestLong.number, "2026-03-17T09:30:00Z"); // 90
  // Umbral 0: 1 min cuenta.
  await punch(personZero.number, "2026-03-17T08:00:00Z");
  await punch(personZero.number, "2026-03-17T17:01:00Z"); // 1
  // Multidía: un día bajo el mínimo (45 → 0) y otro por encima (89).
  await punch(personMulti.number, "2026-03-17T08:00:00Z");
  await punch(personMulti.number, "2026-03-17T17:45:00Z"); // 45 → 0
  await punch(personMulti.number, `${DATE3}T08:00:00Z`);
  await punch(personMulti.number, `${DATE3}T18:29:00Z`); // 89

  // X: solo eventos de la bitácora `/access` (sin checadas) → NO debe generar extra.
  await db.accessEvent.createMany({
    data: [
      {
        type: "ENTRY",
        occurredAt: new Date("2026-03-10T08:00:00Z"),
        employeeId: personAccessOnly.id,
        method: "MANUAL",
        locationSource: "SITE_ONLY",
        clientEventId: `${E2E_PREFIX}-${RUN}-OT-ACC-1`,
      },
      {
        type: "EXIT",
        occurredAt: new Date("2026-03-10T20:00:00Z"),
        employeeId: personAccessOnly.id,
        method: "MANUAL",
        locationSource: "SITE_ONLY",
        clientEventId: `${E2E_PREFIX}-${RUN}-OT-ACC-2`,
      },
    ],
  });

  // Usuarios de permisos (sin checadas).
  await createUser("RH", "HUMAN_RESOURCES");
  await createUser("HEAD", "AREA_HEAD");
  await createUser("MGR", "MANAGER");
});

test.afterAll(async () => {
  await Promise.all(contexts.map((c) => c.dispose()));
  // La bitácora de acceso apunta a usuarios: se borra antes que ellos.
  await db.accessEvent.deleteMany({
    where: { clientEventId: { startsWith: `${E2E_PREFIX}-${RUN}-OT-ACC` } },
  });
  if (userIds.length) {
    await db.overtimeApproval.deleteMany({ where: { userId: { in: userIds } } });
    await db.auditLog.deleteMany({ where: { userId: { in: userIds } } });
  }
  await db.timeClockPunch.deleteMany({ where: { clockSerial: SERIAL } });
  if (numbers.length) {
    await db.timeClockEmployee.deleteMany({ where: { employeeNumber: { in: numbers } } });
  }
  if (userIds.length) {
    await db.scheduleAssignment.deleteMany({ where: { userId: { in: userIds } } });
    await db.user.deleteMany({ where: { id: { in: userIds } } });
  }
  await db.schedule.deleteMany({
    where: {
      name: {
        in: [
          SCHEDULE_MAIN,
          SCHEDULE_REST,
          SCHEDULE_SNAP,
          SCHEDULE_MIN60,
          SCHEDULE_MIN60_REST,
          SCHEDULE_MIN0,
        ],
      },
    },
  });
  await db.department.deleteMany({ where: { id: deptId } });
});

test.describe("Overtime — aprobación de tiempo extra (E2E)", () => {
  test("permisos: 401 anónimo; solo ADMIN/GERENTE aprueban; RH consulta solo lo aprobado", async ({
    ctxAnonymous,
    ctxEmployee,
    ctxGuard,
  }) => {
    const ctxRh = await contextFor(`e2e_overtime_${RUN}_RH`.toLowerCase());
    const ctxHead = await contextFor(`e2e_overtime_${RUN}_JEFE`.toLowerCase());
    const ctxManager = await contextFor(`e2e_overtime_${RUN}_GER`.toLowerCase());

    const query = { page: 1, limit: 10, filters: { period: "DAY", date: DATE, tz: TZ } };

    expect((await ctxAnonymous.post("overtime/query", { data: query })).status()).toBe(401);
    for (const ctx of [ctxEmployee, ctxGuard, ctxHead]) {
      expect((await ctx.post("overtime/query", { data: query })).status()).toBe(403);
    }
    expect(
      (await ctxRh.post("overtime/approvals", { data: { items: [], status: "APPROVED" } })).status()
    ).toBe(403);

    // RH y GERENTE consultan el detalle (RH recibe solo lo aprobado).
    expect((await ctxRh.post("overtime/query", { data: query })).status()).toBe(200);
    expect((await ctxManager.post("overtime/query", { data: query })).status()).toBe(200);

    // El detalle por día de horas extra es solo ADMIN/GERENTE: RH y JEFE reciben 403.
    for (const ctx of [ctxRh, ctxHead]) {
      expect(
        (await ctx.post("schedules/overtime/query", { data: query })).status()
      ).toBe(403);
    }
    // El export sigue disponible para RH (fuente del PDF/CSV de aprobados).
    expect(
      (await ctxRh.post("schedules/overtime/export", { data: query })).status()
    ).toBe(200);
  });

  test("pendiente por defecto; sin vínculo, sin horario y solo bitácora quedan fuera", async ({
    ctxAdmin,
  }) => {
    const body = await queryOvertime(ctxAdmin);

    const rowA = findRow(body, personA.id);
    expect(rowA).toMatchObject({ status: "PENDING", extraMin: 120, approvedExtraMin: 0 });
    expect(rowA?.decidedByName).toBeNull();

    const rowRest = findRow(body, personRest.id);
    expect(rowRest).toMatchObject({ status: "PENDING", extraMin: 240, restDay: true });

    // Sin vínculo (reloj:<num>) y sin horario (extra 0) no son días aprobables.
    expect(findRow(body, personUnlinked.id)).toBeUndefined();
    expect(findRow(body, personWithoutSchedule.id)).toBeUndefined();
    // Solo bitácora `/access`, sin checadas: no genera extra (confirma el swap).
    expect(findRow(body, personAccessOnly.id)).toBeUndefined();

    expect(body.summary.pendingMinutes).toBe(480);
    expect(body.summary.approvedMinutes).toBe(0);
    expect(body.summary.peopleWithPending).toBe(3);
  });

  test("aprobar deja el snapshot y contabiliza aprobadoMin; rechazar suma rechazadoMin", async ({
    ctxAdmin,
  }) => {
    const approve = await ctxAdmin.post("overtime/approvals", {
      data: {
        filters: { period: "DAY", date: DATE, tz: TZ, departmentId: deptId },
        items: [{ userId: personA.id, date: DATE }],
        status: "APPROVED",
      },
    });
    expect(approve.status(), await approve.text()).toBe(200);
    expect(await approve.json()).toMatchObject({ updated: 1, skipped: 0 });

    let body = await queryOvertime(ctxAdmin);
    expect(findRow(body, personA.id)).toMatchObject({
      status: "APPROVED",
      extraMin: 120,
      approvedExtraMin: 120,
    });

    // La fila queda en la tabla con el snapshot y quién decidió.
    const saved = await db.overtimeApproval.findFirst({ where: { userId: personA.id } });
    expect(saved).toMatchObject({ status: "APPROVED", extraMin: 120 });
    expect(saved?.decidedById).not.toBeNull();

    // Rechazar el día de descanso.
    const reject = await ctxAdmin.post("overtime/approvals", {
      data: {
        filters: { period: "DAY", date: DATE, tz: TZ, departmentId: deptId },
        items: [{ userId: personRest.id, date: DATE }],
        status: "REJECTED",
      },
    });
    expect(await reject.json()).toMatchObject({ updated: 1, skipped: 0 });

    body = await queryOvertime(ctxAdmin);
    expect(findRow(body, personRest.id)).toMatchObject({ status: "REJECTED", approvedExtraMin: 0 });
    expect(body.summary.approvedMinutes).toBe(120);
    expect(body.summary.rejectedMinutes).toBe(240);
    expect(body.summary.pendingMinutes).toBe(120);

    // El reporte por persona refleja lo contabilizado.
    const res = await ctxAdmin.post("schedules/overtime/query", {
      data: {
        page: 1,
        limit: 100,
        filters: { period: "DAY", date: DATE, tz: TZ, departmentId: deptId },
      },
    });
    const hours = (await res.json()) as {
      data: Array<{ userId: string; approvedMin: number; rejectedMin: number; pendingMin: number }>;
    };
    const rowA = hours.data.find((r) => r.userId === personA.id);
    expect(rowA).toMatchObject({ approvedMin: 120, pendingMin: 0 });
  });

  test("revertir a PENDIENTE borra la decisión; re-aprobar es upsert", async ({ ctxAdmin }) => {
    const revert = await ctxAdmin.post("overtime/approvals", {
      data: {
        filters: { period: "DAY", date: DATE, tz: TZ, departmentId: deptId },
        items: [{ userId: personRest.id, date: DATE }],
        status: "PENDING",
      },
    });
    expect(await revert.json()).toMatchObject({ updated: 1, skipped: 0 });
    expect(await db.overtimeApproval.count({ where: { userId: personRest.id } })).toBe(0);

    const body = await queryOvertime(ctxAdmin);
    expect(findRow(body, personRest.id)).toMatchObject({ status: "PENDING" });

    // Re-aprobar el mismo día no duplica: es upsert sobre (userId, date).
    for (let i = 0; i < 2; i += 1) {
      const res = await ctxAdmin.post("overtime/approvals", {
        data: {
          filters: { period: "DAY", date: DATE, tz: TZ, departmentId: deptId },
          items: [{ userId: personA.id, date: DATE }],
          status: "APPROVED",
        },
      });
      expect(await res.json()).toMatchObject({ updated: 1 });
    }
    expect(await db.overtimeApproval.count({ where: { userId: personA.id } })).toBe(1);
  });

  test("el snapshot aprobado es inmutable: cambiar el horario no lo mueve", async ({ ctxAdmin }) => {
    const baseFilters = { period: "DAY", date: DATE, tz: TZ, departmentId: deptId };
    const approve = await ctxAdmin.post("overtime/approvals", {
      data: { filters: baseFilters, items: [{ userId: personSnap.id, date: DATE }], status: "APPROVED" },
    });
    expect(await approve.json()).toMatchObject({ updated: 1 });

    // La salida programada se adelanta a las 16:00: el cálculo pasa a 180 min…
    await db.scheduleDay.updateMany({
      where: { scheduleId: scheduleSnapId, weekday: 2 },
      data: { endTime: "16:00" },
    });

    const body = await queryOvertime(ctxAdmin);
    const rowSnap = findRow(body, personSnap.id);
    // …pero lo aprobado sigue siendo el snapshot original (120).
    expect(rowSnap).toMatchObject({ status: "APPROVED", extraMin: 180, approvedExtraMin: 120 });
  });

  test("edge: periodo/fecha inválidos y items vacío son 400; item inexistente se omite", async ({
    ctxAdmin,
  }) => {
    const invalidPeriod = await ctxAdmin.post("overtime/query", {
      data: { page: 1, limit: 10, filters: { period: "YEAR", date: DATE, tz: TZ } },
    });
    expect(invalidPeriod.status()).toBe(400);

    const invalidDate = await ctxAdmin.post("overtime/query", {
      data: { page: 1, limit: 10, filters: { period: "DAY", date: "10/03/2026", tz: TZ } },
    });
    expect(invalidDate.status()).toBe(400);

    const withoutItems = await ctxAdmin.post("overtime/approvals", {
      data: {
        filters: { period: "DAY", date: DATE, tz: TZ },
        items: [],
        status: "APPROVED",
      },
    });
    expect(withoutItems.status()).toBe(400);

    // Un día que no existe en el cálculo se omite (skipped).
    const nonexistent = await ctxAdmin.post("overtime/approvals", {
      data: {
        filters: { period: "DAY", date: DATE, tz: TZ, departmentId: deptId },
        items: [{ userId: personA.id, date: "2026-03-11" }],
        status: "APPROVED",
      },
    });
    expect(nonexistent.status()).toBe(200);
    expect(await nonexistent.json()).toMatchObject({ updated: 0, skipped: 1 });
  });

  test("RH solo ve lo aprobado: el status pedido se ignora en el servidor", async ({
    ctxAdmin,
  }) => {
    const baseFilters = { period: "DAY", date: DATE, tz: TZ, departmentId: deptId };
    // A queda aprobado y R rechazado; S ya venía aprobado de un caso previo.
    await ctxAdmin.post("overtime/approvals", {
      data: { filters: baseFilters, items: [{ userId: personA.id, date: DATE }], status: "APPROVED" },
    });
    await ctxAdmin.post("overtime/approvals", {
      data: { filters: baseFilters, items: [{ userId: personRest.id, date: DATE }], status: "REJECTED" },
    });

    const ctxRh = await contextFor(`e2e_overtime_${RUN}_RH`.toLowerCase());

    // Aunque RH pida PENDIENTE (o no pida status), solo recibe APROBADO.
    for (const filters of [{ ...baseFilters, status: "PENDING" }, { ...baseFilters }]) {
      const res = await ctxRh.post("overtime/query", {
        data: { page: 1, limit: 100, filters },
      });
      expect(res.status(), await res.text()).toBe(200);
      const body = (await res.json()) as OvertimeResponse;
      expect(body.data.length).toBeGreaterThan(0);
      expect(body.data.every((r) => r.status === "APPROVED")).toBe(true);
      expect(findRow(body, personA.id)).toBeDefined();
      expect(findRow(body, personRest.id)).toBeUndefined();
      expect(body.summary.pendingMinutes).toBe(0);
      expect(body.summary.rejectedMinutes).toBe(0);
      expect(body.summary.peopleWithPending).toBe(0);
    }
  });

  test("export: solo personas con aprobadoMin > 0 y totales en modo aprobado", async ({
    ctxAdmin,
  }) => {
    const baseFilters = { period: "DAY", date: DATE, tz: TZ, departmentId: deptId };
    const res = await ctxAdmin.post("schedules/overtime/export", {
      data: { page: 1, limit: 1, filters: baseFilters },
    });
    expect(res.status(), await res.text()).toBe(200);
    const body = (await res.json()) as {
      data: Array<{
        userId: string;
        extraMin: number;
        approvedMin: number;
        pendingMin: number;
        rejectedMin: number;
        daysWithExtra: number;
        approvedDays: number;
      }>;
      total: number;
      summary: {
        totalExtraMinutes: number;
        totalApprovedMinutes: number;
        totalPendingMinutes: number;
        totalRejectedMinutes: number;
      };
    };

    expect(body.data.length).toBeGreaterThan(0);
    for (const r of body.data) {
      expect(r.approvedMin).toBeGreaterThan(0);
      expect(r.pendingMin).toBe(0);
      expect(r.rejectedMin).toBe(0);
      // El cálculo se enmascara por lo aprobado.
      expect(r.extraMin).toBe(r.approvedMin);
      expect(r.daysWithExtra).toBe(r.approvedDays);
    }
    expect(body.summary.totalExtraMinutes).toBe(body.summary.totalApprovedMinutes);
    expect(body.summary.totalPendingMinutes).toBe(0);
    expect(body.summary.totalRejectedMinutes).toBe(0);

    // RH también puede exportar (misma fuente approved-only).
    const ctxRh = await contextFor(`e2e_overtime_${RUN}_RH`.toLowerCase());
    const resRh = await ctxRh.post("schedules/overtime/export", {
      data: { page: 1, limit: 1, filters: baseFilters },
    });
    expect(resRh.status()).toBe(200);
  });

  test("umbral de extra: mínimo 60, borde >=, descanso y 0 = sin mínimo", async ({
    ctxAdmin,
  }) => {
    const body = await queryOvertimeOn(ctxAdmin, DATE2);

    // Por debajo del mínimo no son días de tiempo extra (no aparecen).
    expect(findRow(body, personBelow.id)).toBeUndefined();
    expect(findRow(body, personBelow59.id)).toBeUndefined();
    expect(findRow(body, personRestShort.id)).toBeUndefined();

    // Por encima del mínimo se cuentan los minutos exactos (sin redondeo).
    expect(findRow(body, personAbove.id)).toMatchObject({ extraMin: 89, status: "PENDING" });
    // Borde `>=`: 60 exactos cuentan.
    expect(findRow(body, personExact.id)).toMatchObject({ extraMin: 60 });
    // Día de descanso con umbral: 90 ≥ 60 → 90.
    expect(findRow(body, personRestLong.id)).toMatchObject({ extraMin: 90, restDay: true });
    // Umbral 0: 1 min cuenta.
    expect(findRow(body, personZero.id)).toMatchObject({ extraMin: 1 });

    // Un día bajo el mínimo no es aprobable (skipped).
    const skipped = await ctxAdmin.post("overtime/approvals", {
      data: {
        filters: { period: "DAY", date: DATE2, tz: TZ, departmentId: deptId },
        items: [{ userId: personBelow.id, date: DATE2 }],
        status: "APPROVED",
      },
    });
    expect(await skipped.json()).toMatchObject({ updated: 0, skipped: 1 });

    // Un día por encima del mínimo sí es aprobable.
    const approved = await ctxAdmin.post("overtime/approvals", {
      data: {
        filters: { period: "DAY", date: DATE2, tz: TZ, departmentId: deptId },
        items: [{ userId: personAbove.id, date: DATE2 }],
        status: "APPROVED",
      },
    });
    expect(await approved.json()).toMatchObject({ updated: 1, skipped: 0 });
  });

  test("diasConExtra no cuenta los días por debajo del mínimo", async ({ ctxAdmin }) => {
    const res = await ctxAdmin.post("schedules/overtime/query", {
      data: {
        page: 1,
        limit: 100,
        filters: { period: "MONTH", date: DATE2, tz: TZ, departmentId: deptId },
      },
    });
    expect(res.status(), await res.text()).toBe(200);
    const body = (await res.json()) as {
      data: Array<{ userId: string; extraMin: number; daysWithExtra: number }>;
    };
    const row = body.data.find((r) => r.userId === personMulti.id);
    // Dos días trabajados, uno bajo el mínimo: solo el día con extra cuenta.
    expect(row).toMatchObject({ extraMin: 89, daysWithExtra: 1 });
  });
});
