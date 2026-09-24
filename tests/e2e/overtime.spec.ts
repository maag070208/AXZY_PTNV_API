import type { APIRequestContext } from "@playwright/test";
import { request as playwrightRequest } from "@playwright/test";
import type { Role } from "@prisma/client";
import bcrypt from "bcryptjs";
import { test, expect } from "./support/fixtures";
import { db } from "./support/db";
import { E2E, E2E_PREFIX, assertBaseDeDatosSegura, nuevoRunId } from "./support/env";

/**
 * E2E de contrato — aprobación de tiempo extra (`/overtime`).
 *
 * El tiempo extra se calcula con las CHECADAS del reloj (no con la bitácora del
 * guardia). Aquí se siembran a mano el horario, la asignación, el vínculo
 * reloj ↔ usuario y las checadas bajo una serie propia `E2E-OT-<run>`; todo se
 * borra al final por prefijo. Las consultas se aíslan por un departamento propio.
 */
assertBaseDeDatosSegura();

const RUN = nuevoRunId();
const SERIE = `${E2E_PREFIX}-OT-${RUN}`;
const DEPT_NAME = `E2E OT Depto ${RUN}`;
const HORARIO_MAIN = `E2E OT Horario ${RUN}`;
const HORARIO_REST = `E2E OT Descanso ${RUN}`;
const HORARIO_SNAP = `E2E OT Snapshot ${RUN}`;
const DATE = "2026-03-10"; // martes
const TZ = "UTC";

let serial = 0;
let deptId = "";
let horarioMainId = "";
let horarioRestId = "";
let horarioSnapId = "";

const userIds: string[] = [];
const numeros: string[] = [];
const contextos: APIRequestContext[] = [];

interface Persona {
  id: string;
  name: string;
  numero: string;
}

const crearUsuario = async (sufijo: string, role: Role = "EMPLEADO"): Promise<Persona> => {
  const name = `E2E OT ${RUN} ${sufijo}`;
  const user = await db.user.create({
    data: {
      username: `e2e_overtime_${RUN}_${sufijo}`.toLowerCase(),
      name,
      role,
      active: true,
      departmentId: deptId,
      password: await bcrypt.hash(E2E.password, 10),
    },
    select: { id: true, name: true },
  });
  userIds.push(user.id);
  const numero = `${E2E_PREFIX}${RUN}${sufijo}`;
  numeros.push(numero);
  return { id: user.id, name: user.name, numero };
};

const vincular = async (p: Persona): Promise<void> => {
  await db.checadorEmpleado.create({ data: { numeroEmpleado: p.numero, userId: p.id } });
};

const asignar = async (p: Persona, horarioId: string): Promise<void> => {
  await db.asignacionHorario.create({
    data: { userId: p.id, horarioId, desde: new Date("2026-03-01T00:00:00.000Z") },
  });
};

const checar = async (numero: string, occurredAt: string): Promise<void> => {
  await db.checada.create({
    data: {
      dispositivoSerie: SERIE,
      serialNo: ++serial,
      numeroEmpleado: numero,
      nombre: `E2E OT Checada ${RUN} ${numero}`,
      metodo: "ROSTRO",
      minor: 75,
      occurredAt: new Date(occurredAt),
    },
  });
};

const crearHorario = async (nombre: string, descansoDiaSemana?: number): Promise<string> => {
  const horario = await db.horario.create({
    data: {
      nombre,
      toleranciaSalidaMin: 0,
      comidaMin: 0,
      dias: {
        create: [1, 2, 3, 4, 5, 6, 7].map((diaSemana) => ({
          diaSemana,
          descanso: diaSemana === descansoDiaSemana,
          entrada: diaSemana === descansoDiaSemana ? null : "08:00",
          salida: diaSemana === descansoDiaSemana ? null : "17:00",
        })),
      },
    },
    select: { id: true },
  });
  return horario.id;
};

const contextoPara = async (username: string): Promise<APIRequestContext> => {
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
  contextos.push(ctx);
  return ctx;
};

interface OvertimeRow {
  userId: string;
  date: string;
  extraMin: number;
  status: string;
  approvedExtraMin: number;
  sinHorario: boolean;
  descanso: boolean;
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

const queryOvertime = async (ctx: APIRequestContext): Promise<OvertimeResponse> => {
  const res = await ctx.post("overtime/query", {
    data: {
      page: 1,
      limit: 100,
      filters: { period: "DAY", date: DATE, tz: TZ, departmentId: deptId },
    },
  });
  expect(res.status(), await res.text()).toBe(200);
  return (await res.json()) as OvertimeResponse;
};

const findRow = (body: OvertimeResponse, userId: string): OvertimeRow | undefined =>
  body.data.find((r) => r.userId === userId);

let personaA: Persona;
let personaRest: Persona;
let personaSnap: Persona;
let personaSinHorario: Persona;
let personaUnlinked: Persona;
let personaAccessOnly: Persona;

test.beforeAll(async () => {
  const dept = await db.department.create({ data: { name: DEPT_NAME } });
  deptId = dept.id;

  horarioMainId = await crearHorario(HORARIO_MAIN);
  horarioRestId = await crearHorario(HORARIO_REST, 2); // martes de descanso
  horarioSnapId = await crearHorario(HORARIO_SNAP);

  personaA = await crearUsuario("A");
  personaRest = await crearUsuario("R");
  personaSnap = await crearUsuario("S");
  personaSinHorario = await crearUsuario("N");
  personaUnlinked = await crearUsuario("U");
  personaAccessOnly = await crearUsuario("X");

  for (const p of [personaA, personaRest, personaSnap, personaSinHorario, personaAccessOnly]) {
    await vincular(p);
  }
  // personaUnlinked queda SIN vínculo a propósito.

  await asignar(personaA, horarioMainId);
  await asignar(personaRest, horarioRestId);
  await asignar(personaSnap, horarioSnapId);
  await asignar(personaAccessOnly, horarioMainId);
  // personaSinHorario no tiene asignación a propósito.

  // A: 08:00 → 19:00 → 120 min extra (salida programada 17:00).
  await checar(personaA.numero, "2026-03-10T08:00:00Z");
  await checar(personaA.numero, "2026-03-10T19:00:00Z");
  // Descanso: 08:00 → 12:00, todo lo trabajado cuenta (240).
  await checar(personaRest.numero, "2026-03-10T08:00:00Z");
  await checar(personaRest.numero, "2026-03-10T12:00:00Z");
  // Snapshot: 08:00 → 19:00 → 120 min extra.
  await checar(personaSnap.numero, "2026-03-10T08:00:00Z");
  await checar(personaSnap.numero, "2026-03-10T19:00:00Z");
  // Sin horario y sin vínculo: checan igual.
  await checar(personaSinHorario.numero, "2026-03-10T08:00:00Z");
  await checar(personaSinHorario.numero, "2026-03-10T19:00:00Z");
  await checar(personaUnlinked.numero, "2026-03-10T08:00:00Z");
  await checar(personaUnlinked.numero, "2026-03-10T19:00:00Z");

  // X: solo eventos de la bitácora `/access` (sin checadas) → NO debe generar extra.
  await db.accessEvent.createMany({
    data: [
      {
        type: "ENTRY",
        occurredAt: new Date("2026-03-10T08:00:00Z"),
        employeeId: personaAccessOnly.id,
        method: "MANUAL",
        locationSource: "SITE_ONLY",
        clientEventId: `${E2E_PREFIX}-${RUN}-OT-ACC-1`,
      },
      {
        type: "EXIT",
        occurredAt: new Date("2026-03-10T20:00:00Z"),
        employeeId: personaAccessOnly.id,
        method: "MANUAL",
        locationSource: "SITE_ONLY",
        clientEventId: `${E2E_PREFIX}-${RUN}-OT-ACC-2`,
      },
    ],
  });

  // Usuarios de permisos (sin checadas).
  await crearUsuario("RH", "RECURSOS_HUMANOS");
  await crearUsuario("JEFE", "JEFE_DE_AREA");
  await crearUsuario("GER", "GERENTE");
});

test.afterAll(async () => {
  await Promise.all(contextos.map((c) => c.dispose()));
  // La bitácora de acceso apunta a usuarios: se borra antes que ellos.
  await db.accessEvent.deleteMany({
    where: { clientEventId: { startsWith: `${E2E_PREFIX}-${RUN}-OT-ACC` } },
  });
  if (userIds.length) {
    await db.overtimeApproval.deleteMany({ where: { userId: { in: userIds } } });
    await db.auditLog.deleteMany({ where: { userId: { in: userIds } } });
  }
  await db.checada.deleteMany({ where: { dispositivoSerie: SERIE } });
  if (numeros.length) {
    await db.checadorEmpleado.deleteMany({ where: { numeroEmpleado: { in: numeros } } });
  }
  if (userIds.length) {
    await db.asignacionHorario.deleteMany({ where: { userId: { in: userIds } } });
    await db.user.deleteMany({ where: { id: { in: userIds } } });
  }
  await db.horario.deleteMany({
    where: { nombre: { in: [HORARIO_MAIN, HORARIO_REST, HORARIO_SNAP] } },
  });
  await db.department.deleteMany({ where: { id: deptId } });
});

test.describe("Overtime — aprobación de tiempo extra (E2E)", () => {
  test("permisos: 401 anónimo; solo ADMIN/GERENTE aprueban; RH consulta solo lo aprobado", async ({
    ctxAnonimo,
    ctxEmpleado,
    ctxGuard,
  }) => {
    const ctxRh = await contextoPara(`e2e_overtime_${RUN}_RH`.toLowerCase());
    const ctxJefe = await contextoPara(`e2e_overtime_${RUN}_JEFE`.toLowerCase());
    const ctxGer = await contextoPara(`e2e_overtime_${RUN}_GER`.toLowerCase());

    const query = { page: 1, limit: 10, filters: { period: "DAY", date: DATE, tz: TZ } };

    expect((await ctxAnonimo.post("overtime/query", { data: query })).status()).toBe(401);
    for (const ctx of [ctxEmpleado, ctxGuard, ctxJefe]) {
      expect((await ctx.post("overtime/query", { data: query })).status()).toBe(403);
    }
    expect(
      (await ctxRh.post("overtime/approvals", { data: { items: [], status: "APROBADO" } })).status()
    ).toBe(403);

    // RH y GERENTE consultan el detalle (RH recibe solo lo aprobado).
    expect((await ctxRh.post("overtime/query", { data: query })).status()).toBe(200);
    expect((await ctxGer.post("overtime/query", { data: query })).status()).toBe(200);

    // El detalle por día de horas extra es solo ADMIN/GERENTE: RH y JEFE reciben 403.
    for (const ctx of [ctxRh, ctxJefe]) {
      expect(
        (await ctx.post("horarios/horas-extra/query", { data: query })).status()
      ).toBe(403);
    }
    // El export sigue disponible para RH (fuente del PDF/CSV de aprobados).
    expect(
      (await ctxRh.post("horarios/horas-extra/export", { data: query })).status()
    ).toBe(200);
  });

  test("pendiente por defecto; sin vínculo, sin horario y solo bitácora quedan fuera", async ({
    ctxAdmin,
  }) => {
    const body = await queryOvertime(ctxAdmin);

    const rowA = findRow(body, personaA.id);
    expect(rowA).toMatchObject({ status: "PENDIENTE", extraMin: 120, approvedExtraMin: 0 });
    expect(rowA?.decidedByName).toBeNull();

    const rowRest = findRow(body, personaRest.id);
    expect(rowRest).toMatchObject({ status: "PENDIENTE", extraMin: 240, descanso: true });

    // Sin vínculo (reloj:<num>) y sin horario (extra 0) no son días aprobables.
    expect(findRow(body, personaUnlinked.id)).toBeUndefined();
    expect(findRow(body, personaSinHorario.id)).toBeUndefined();
    // Solo bitácora `/access`, sin checadas: no genera extra (confirma el swap).
    expect(findRow(body, personaAccessOnly.id)).toBeUndefined();

    expect(body.summary.pendingMinutes).toBe(480);
    expect(body.summary.approvedMinutes).toBe(0);
    expect(body.summary.peopleWithPending).toBe(3);
  });

  test("aprobar deja el snapshot y contabiliza aprobadoMin; rechazar suma rechazadoMin", async ({
    ctxAdmin,
  }) => {
    const aprobar = await ctxAdmin.post("overtime/approvals", {
      data: {
        filters: { period: "DAY", date: DATE, tz: TZ, departmentId: deptId },
        items: [{ userId: personaA.id, date: DATE }],
        status: "APROBADO",
      },
    });
    expect(aprobar.status(), await aprobar.text()).toBe(200);
    expect(await aprobar.json()).toMatchObject({ updated: 1, skipped: 0 });

    let body = await queryOvertime(ctxAdmin);
    expect(findRow(body, personaA.id)).toMatchObject({
      status: "APROBADO",
      extraMin: 120,
      approvedExtraMin: 120,
    });

    // La fila queda en la tabla con el snapshot y quién decidió.
    const guardada = await db.overtimeApproval.findFirst({ where: { userId: personaA.id } });
    expect(guardada).toMatchObject({ status: "APROBADO", extraMin: 120 });
    expect(guardada?.decidedById).not.toBeNull();

    // Rechazar el día de descanso.
    const rechazar = await ctxAdmin.post("overtime/approvals", {
      data: {
        filters: { period: "DAY", date: DATE, tz: TZ, departmentId: deptId },
        items: [{ userId: personaRest.id, date: DATE }],
        status: "RECHAZADO",
      },
    });
    expect(await rechazar.json()).toMatchObject({ updated: 1, skipped: 0 });

    body = await queryOvertime(ctxAdmin);
    expect(findRow(body, personaRest.id)).toMatchObject({ status: "RECHAZADO", approvedExtraMin: 0 });
    expect(body.summary.approvedMinutes).toBe(120);
    expect(body.summary.rejectedMinutes).toBe(240);
    expect(body.summary.pendingMinutes).toBe(120);

    // El reporte por persona refleja lo contabilizado.
    const res = await ctxAdmin.post("horarios/horas-extra/query", {
      data: {
        page: 1,
        limit: 100,
        filters: { period: "DAY", date: DATE, tz: TZ, departmentId: deptId },
      },
    });
    const horas = (await res.json()) as {
      data: Array<{ userId: string; aprobadoMin: number; rechazadoMin: number; pendienteMin: number }>;
    };
    const filaA = horas.data.find((r) => r.userId === personaA.id);
    expect(filaA).toMatchObject({ aprobadoMin: 120, pendienteMin: 0 });
  });

  test("revertir a PENDIENTE borra la decisión; re-aprobar es upsert", async ({ ctxAdmin }) => {
    const revertir = await ctxAdmin.post("overtime/approvals", {
      data: {
        filters: { period: "DAY", date: DATE, tz: TZ, departmentId: deptId },
        items: [{ userId: personaRest.id, date: DATE }],
        status: "PENDIENTE",
      },
    });
    expect(await revertir.json()).toMatchObject({ updated: 1, skipped: 0 });
    expect(await db.overtimeApproval.count({ where: { userId: personaRest.id } })).toBe(0);

    const body = await queryOvertime(ctxAdmin);
    expect(findRow(body, personaRest.id)).toMatchObject({ status: "PENDIENTE" });

    // Re-aprobar el mismo día no duplica: es upsert sobre (userId, date).
    for (let i = 0; i < 2; i += 1) {
      const res = await ctxAdmin.post("overtime/approvals", {
        data: {
          filters: { period: "DAY", date: DATE, tz: TZ, departmentId: deptId },
          items: [{ userId: personaA.id, date: DATE }],
          status: "APROBADO",
        },
      });
      expect(await res.json()).toMatchObject({ updated: 1 });
    }
    expect(await db.overtimeApproval.count({ where: { userId: personaA.id } })).toBe(1);
  });

  test("el snapshot aprobado es inmutable: cambiar el horario no lo mueve", async ({ ctxAdmin }) => {
    const filtros = { period: "DAY", date: DATE, tz: TZ, departmentId: deptId };
    const aprobar = await ctxAdmin.post("overtime/approvals", {
      data: { filters: filtros, items: [{ userId: personaSnap.id, date: DATE }], status: "APROBADO" },
    });
    expect(await aprobar.json()).toMatchObject({ updated: 1 });

    // La salida programada se adelanta a las 16:00: el cálculo pasa a 180 min…
    await db.horarioDia.updateMany({
      where: { horarioId: horarioSnapId, diaSemana: 2 },
      data: { salida: "16:00" },
    });

    const body = await queryOvertime(ctxAdmin);
    const rowSnap = findRow(body, personaSnap.id);
    // …pero lo aprobado sigue siendo el snapshot original (120).
    expect(rowSnap).toMatchObject({ status: "APROBADO", extraMin: 180, approvedExtraMin: 120 });
  });

  test("edge: periodo/fecha inválidos y items vacío son 400; item inexistente se omite", async ({
    ctxAdmin,
  }) => {
    const periodInvalido = await ctxAdmin.post("overtime/query", {
      data: { page: 1, limit: 10, filters: { period: "YEAR", date: DATE, tz: TZ } },
    });
    expect(periodInvalido.status()).toBe(400);

    const fechaInvalida = await ctxAdmin.post("overtime/query", {
      data: { page: 1, limit: 10, filters: { period: "DAY", date: "10/03/2026", tz: TZ } },
    });
    expect(fechaInvalida.status()).toBe(400);

    const sinItems = await ctxAdmin.post("overtime/approvals", {
      data: {
        filters: { period: "DAY", date: DATE, tz: TZ },
        items: [],
        status: "APROBADO",
      },
    });
    expect(sinItems.status()).toBe(400);

    // Un día que no existe en el cálculo se omite (skipped).
    const inexistente = await ctxAdmin.post("overtime/approvals", {
      data: {
        filters: { period: "DAY", date: DATE, tz: TZ, departmentId: deptId },
        items: [{ userId: personaA.id, date: "2026-03-11" }],
        status: "APROBADO",
      },
    });
    expect(inexistente.status()).toBe(200);
    expect(await inexistente.json()).toMatchObject({ updated: 0, skipped: 1 });
  });

  test("RH solo ve lo aprobado: el status pedido se ignora en el servidor", async ({
    ctxAdmin,
  }) => {
    const filtros = { period: "DAY", date: DATE, tz: TZ, departmentId: deptId };
    // A queda aprobado y R rechazado; S ya venía aprobado de un caso previo.
    await ctxAdmin.post("overtime/approvals", {
      data: { filters: filtros, items: [{ userId: personaA.id, date: DATE }], status: "APROBADO" },
    });
    await ctxAdmin.post("overtime/approvals", {
      data: { filters: filtros, items: [{ userId: personaRest.id, date: DATE }], status: "RECHAZADO" },
    });

    const ctxRh = await contextoPara(`e2e_overtime_${RUN}_RH`.toLowerCase());

    // Aunque RH pida PENDIENTE (o no pida status), solo recibe APROBADO.
    for (const filters of [{ ...filtros, status: "PENDIENTE" }, { ...filtros }]) {
      const res = await ctxRh.post("overtime/query", {
        data: { page: 1, limit: 100, filters },
      });
      expect(res.status(), await res.text()).toBe(200);
      const body = (await res.json()) as OvertimeResponse;
      expect(body.data.length).toBeGreaterThan(0);
      expect(body.data.every((r) => r.status === "APROBADO")).toBe(true);
      expect(findRow(body, personaA.id)).toBeDefined();
      expect(findRow(body, personaRest.id)).toBeUndefined();
      expect(body.summary.pendingMinutes).toBe(0);
      expect(body.summary.rejectedMinutes).toBe(0);
      expect(body.summary.peopleWithPending).toBe(0);
    }
  });

  test("export: solo personas con aprobadoMin > 0 y totales en modo aprobado", async ({
    ctxAdmin,
  }) => {
    const filtros = { period: "DAY", date: DATE, tz: TZ, departmentId: deptId };
    const res = await ctxAdmin.post("horarios/horas-extra/export", {
      data: { page: 1, limit: 1, filters: filtros },
    });
    expect(res.status(), await res.text()).toBe(200);
    const body = (await res.json()) as {
      data: Array<{
        userId: string;
        extraMin: number;
        aprobadoMin: number;
        pendienteMin: number;
        rechazadoMin: number;
        diasConExtra: number;
        diasAprobados: number;
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
      expect(r.aprobadoMin).toBeGreaterThan(0);
      expect(r.pendienteMin).toBe(0);
      expect(r.rechazadoMin).toBe(0);
      // El cálculo se enmascara por lo aprobado.
      expect(r.extraMin).toBe(r.aprobadoMin);
      expect(r.diasConExtra).toBe(r.diasAprobados);
    }
    expect(body.summary.totalExtraMinutes).toBe(body.summary.totalApprovedMinutes);
    expect(body.summary.totalPendingMinutes).toBe(0);
    expect(body.summary.totalRejectedMinutes).toBe(0);

    // RH también puede exportar (misma fuente approved-only).
    const ctxRh = await contextoPara(`e2e_overtime_${RUN}_RH`.toLowerCase());
    const resRh = await ctxRh.post("horarios/horas-extra/export", {
      data: { page: 1, limit: 1, filters: filtros },
    });
    expect(resRh.status()).toBe(200);
  });
});
