import { test, expect } from "./support/fixtures";
import type { Scenario } from "./support/fixtures";
import { db } from "./support/db";
import { E2E, assertSafeDatabase } from "./support/env";
import type { InventoryApi, Loan } from "./support/inventory-api";
import {
  DEFAULT_TIMEZONE,
  TIMEZONE_CONFIG_KEY,
  localDateKey,
  localDayRange,
  localMonthRange,
  localWeekRange,
} from "@core/utils/timezone";

/**
 * E2E de contrato — reportes de inventario: resumen de periodo, detalle de
 * entregas y las dos instantáneas con tabla server-side.
 *
 * Periodo FIJO (`PERIOD_*`, 2030) y `timezone: "UTC"` explícito: los eventos los
 * fecha Prisma en instants conocidos, así que los conteos son absolutos y NO
 * dependen de la data real del cliente ni del día en que corra la suite. Cuando
 * el conjunto debe quedar vacío se usa el filtro `typeId` del `scenario`, que es
 * exclusivo del test.
 *
 * Aislamiento por prefijo `E2E` y limpieza en el teardown global (ver
 * `support/db.ts`).
 */
assertSafeDatabase();

/** Periodo de trabajo, deliberadamente lejos de la data sembrada del cliente. */
const PERIOD_DAY = "2030-03-14";
/** Prefijo del mes, sólo para afirmar que los buckets caen dentro del periodo. */
const PERIOD_MONTH_PREFIX = "2030-03";
/** Mismo mes para `period: "MONTH"`: la llave de fecha siempre es un día completo. */
const PERIOD_MONTH = PERIOD_DAY;
const TZ = "UTC";

const msPerDay = 1000 * 60 * 60 * 24;

/** Instante UTC dentro del día `dateKey` (el reporte usa `tz: "UTC"`). */
const at = (dateKey: string, hour: number, minute = 0): Date =>
  new Date(`${dateKey}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00.000Z`);

// ---------------------------------------------------------------------------
// Contratos (espejo de los DTO del API)
// ---------------------------------------------------------------------------

interface PeriodTotals {
  delivered: number;
  returned: number;
  admitted: number;
  net: number;
  distinctRecipients: number;
  distinctDevices: number;
  distinctLoans: number;
  distinctReturns: number;
  distinctMovements: number;
}

interface PeriodBucket {
  day: string;
  delivered: number;
  returned: number;
  admitted: number;
  net: number;
}

interface DeviceAggregate {
  deviceId: string;
  description: string;
  typeId: string;
  typeName: string;
  delivered: number;
  returned: number;
  admitted: number;
  net: number;
}

interface RecipientAggregate {
  userId: string;
  name: string;
  employeeNumber: string | null;
  departmentName: string | null;
  loans: number;
  delivered: number;
  returned: number;
  outstanding: number;
}

interface PeriodSummaryResponse {
  range: { start: string; end: string; timezone: string; period: string; date: string };
  filters: { typeId: string | null; departmentId: string | null; custodianId: string | null };
  totals: PeriodTotals;
  byPeriod: PeriodBucket[];
  byDevice: DeviceAggregate[];
  recipients: RecipientAggregate[];
}

interface DeliveryDetailRow {
  id: string;
  date: string;
  number: string;
  custodianName: string;
  employeeNumber: string | null;
  departmentName: string | null;
  subareaName: string | null;
  deliveredBy: string;
  deviceId: string;
  description: string;
  typeName: string;
  brand: string;
  model: string;
  quantity: number;
  returnedQuantity: number;
  returnDate: string | null;
  returnNumber: string | null;
  status: "ACTIVE" | "PARTIAL" | "RETURNED";
}

interface PeriodDetailResponse {
  data: DeliveryDetailRow[];
  total: number;
  truncated: boolean;
}

interface AssignedDeviceRow {
  deviceId: string;
  assetTag: string;
  description: string;
  brand: string;
  model: string;
  type: string;
  custodian: string;
  employeeNumber: string | null;
  department: string | null;
  date: string | null;
  daysAssigned: number | null;
  source: string;
  folio: string | null;
}

interface DeviceReportRow {
  deviceId: string;
  assetTag: string;
  description: string;
  type: string;
  status: "AVAILABLE" | "ASSIGNED" | "DAMAGED" | "IN_MAINTENANCE" | "RETIRED";
  custodian: string | null;
  employeeNumber: string | null;
  department: string | null;
  daysAssigned: number | null;
  folio: string | null;
}

interface AssignedStats {
  assigned: number;
  averageDays: number;
  over30: number;
}

interface DevicesStats {
  total: number;
  available: number;
  assigned: number;
  retired: number;
  over30: number;
  averageDays: number;
}

interface TableMeta {
  page: number;
  pageIndex: number;
  totalPages: number;
  totalCount: number;
  limit: number;
  hasPreviousPage: boolean;
  hasNextPage: boolean;
}

type TableResponse<T> = TableMeta & { data: T[]; total: number; stats: AssignedStats | DevicesStats };
type ExportResponse<T> = { data: T[]; total: number; stats: AssignedStats | DevicesStats; truncated: boolean };

interface DeliveryReportRow {
  id: string;
  date: string;
  document_code: string;
  responsible: string;
  employee_no: string | null;
  department: string;
  return_date: string | null;
  asset_code: string;
  description: string;
  quantity: number;
  status: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const summaryOf = async (
  inv: InventoryApi,
  body: Record<string, unknown>
): Promise<PeriodSummaryResponse> => {
  const res = await inv.post<PeriodSummaryResponse>("/reports/period-summary", {
    timezone: TZ,
    ...body,
  });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body;
};

const detailOf = async (
  inv: InventoryApi,
  body: Record<string, unknown>
): Promise<PeriodDetailResponse> => {
  const res = await inv.post<PeriodDetailResponse>("/reports/period-summary/detail", {
    timezone: TZ,
    ...body,
  });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body;
};

const monthSummary = (inv: InventoryApi, extra: Record<string, unknown> = {}) =>
  summaryOf(inv, { period: "MONTH", date: PERIOD_MONTH, ...extra });

const adminUser = async () => db.user.findUniqueOrThrow({ where: { username: E2E.admin.username } });
const employeeUser = async () =>
  db.user.findUniqueOrThrow({ where: { username: E2E.employee.username } });

/** Cuándo ocurrió el evento: el API fecha en `now()`, el test decide el día. */
interface Timing {
  dayKey?: string;
  hour?: number;
  minute?: number;
}

/** Préstamo de `quantity` unidades, fechado dentro del periodo de trabajo. */
const lend = async (
  inv: InventoryApi,
  deviceId: string,
  quantity: number,
  opts: { custodianId: string; departmentId: string } & Timing
): Promise<Loan> => {
  const { custodianId, departmentId, dayKey = PERIOD_DAY, hour = 10, minute = 0 } = opts;
  const { loan } = await inv.lend({ custodianId, departmentId, items: [{ deviceId, quantity }] });
  const instant = at(dayKey, hour, minute);
  await db.loan.update({ where: { id: loan.id }, data: { date: instant } });
  if (loan.movementId) {
    await db.movement.update({ where: { id: loan.movementId }, data: { date: instant } });
  }
  return loan;
};

/** Devuelve (parte de) un préstamo y fecha su `LoanReturn` dentro del periodo. */
const returnUnits = async (
  inv: InventoryApi,
  loan: Loan,
  quantity: number,
  opts: { custodianId: string } & Timing
) => {
  const { custodianId, dayKey = PERIOD_DAY, hour = 23, minute = 0 } = opts;
  await inv.returnLoan({
    loanId: loan.id,
    custodianId,
    items: [{ loanItemId: loan.items[0].id, quantity, condition: "GOOD" }],
  });
  const loanReturn = await db.loanReturn.findFirstOrThrow({ where: { loanId: loan.id } });
  const instant = at(dayKey, hour, minute);
  await db.loanReturn.update({ where: { id: loanReturn.id }, data: { date: instant } });
  await db.movement.update({ where: { id: loanReturn.movementId }, data: { date: instant } });
  return { loanReturn, returnDate: instant };
};

/** El alta de un dispositivo emite su movimiento STOCK_IN: lo fecha en el periodo. */
const stockInOf = async (deviceId: string, instant: Date): Promise<string> => {
  const movement = await db.movement.findFirstOrThrow({
    where: { items: { some: { deviceId } }, type: "STOCK_IN" },
  });
  await db.movement.update({ where: { id: movement.id }, data: { date: instant } });
  return movement.id;
};

const emptyTotals: PeriodTotals = {
  delivered: 0,
  returned: 0,
  admitted: 0,
  net: 0,
  distinctRecipients: 0,
  distinctDevices: 0,
  distinctLoans: 0,
  distinctReturns: 0,
  distinctMovements: 0,
};

// ---------------------------------------------------------------------------
// Rango del periodo
// ---------------------------------------------------------------------------

test.describe("REPORTES — rango del periodo", () => {
  test("MONTH devuelve el mes local completo con `end` exclusivo", async ({ inv }) => {
    const body = await summaryOf(inv, { period: "MONTH", date: PERIOD_MONTH, timezone: TZ });
    expect(body.range).toEqual({
      start: localMonthRange(PERIOD_MONTH, TZ).start.toISOString(),
      end: localMonthRange(PERIOD_MONTH, TZ).end.toISOString(),
      timezone: TZ,
      period: "MONTH",
      date: PERIOD_MONTH,
    });
    // `end` es el primer instante del mes siguiente: el borde NO entra.
    expect(body.range.end).toBe("2030-04-01T00:00:00.000Z");
  });

  test("DAY y WEEK devuelven bordes locales coherentes y `end` exclusivo", async ({ inv }) => {
    const day = await summaryOf(inv, { period: "DAY", date: PERIOD_DAY, timezone: TZ });
    expect(day.range.start).toBe(localDayRange(PERIOD_DAY, TZ).start.toISOString());
    expect(day.range.end).toBe(localDayRange(PERIOD_DAY, TZ).end.toISOString());
    expect(new Date(day.range.end).getTime() - new Date(day.range.start).getTime()).toBe(msPerDay);

    const week = await summaryOf(inv, { period: "WEEK", date: PERIOD_DAY, timezone: TZ });
    expect(week.range.start).toBe(localWeekRange(PERIOD_DAY, TZ).start.toISOString());
    expect(week.range.end).toBe(localWeekRange(PERIOD_DAY, TZ).end.toISOString());
    // El día cae dentro de su semana.
    expect(new Date(week.range.start).getTime()).toBeLessThanOrEqual(
      new Date(day.range.start).getTime()
    );
    expect(new Date(week.range.end).getTime()).toBeGreaterThanOrEqual(
      new Date(day.range.end).getTime()
    );
  });

  test("sin `timezone` el servidor resuelve la zona oficial (sys_config → env → default)", async ({
    inv,
  }) => {
    const config = await db.sysConfig.findUnique({
      where: { key: TIMEZONE_CONFIG_KEY },
      select: { value: true },
    });
    const expected = config?.value || process.env[TIMEZONE_CONFIG_KEY] || DEFAULT_TIMEZONE;
    const date = localDateKey(new Date(), expected);

    const res = await inv.post<PeriodSummaryResponse>("/reports/period-summary", {
      period: "MONTH",
      date,
    });
    expect(res.status).toBe(200);
    expect(res.body.range.timezone).toBe(expected);
    expect(res.body.range.start).toBe(localMonthRange(date, expected).start.toISOString());
    expect(res.body.range.end).toBe(localMonthRange(date, expected).end.toISOString());
  });

  test("el instante exacto de `end` NO entra en el periodo", async ({ inv, scenario }) => {
    const device = await scenario.device(1);
    const boundary = new Date(localDayRange(PERIOD_DAY, TZ).end.getTime());
    const movementId = await stockInOf(device.id, boundary);

    const scope = { period: "DAY", date: PERIOD_DAY, typeId: scenario.type.id };
    const outside = await summaryOf(inv, scope);
    expect(outside.totals.admitted).toBe(0);
    expect(outside.byPeriod).toEqual([]);

    // Un milisegundo antes sí entra: la ventana es `[start, end)`.
    await db.movement.update({
      where: { id: movementId },
      data: { date: new Date(boundary.getTime() - 1) },
    });
    const inside = await summaryOf(inv, scope);
    expect(inside.totals.admitted).toBe(1);
    expect(inside.byPeriod).toEqual([
      { day: PERIOD_DAY, delivered: 0, returned: 0, admitted: 1, net: 0 },
    ]);
  });
});

// ---------------------------------------------------------------------------
// Entregas / devoluciones / incorporaciones
// ---------------------------------------------------------------------------

test.describe("REPORTES — series del periodo", () => {
  test("dos préstamos y una devolución: delivered 2, returned 1, net 1", async ({
    inv,
    scenario,
    departmentId,
  }) => {
    const admin = await adminUser();
    const first = await scenario.device(2);
    const second = await scenario.device(1);
    await stockInOf(first.id, at(PERIOD_DAY, 8));
    await stockInOf(second.id, at(PERIOD_DAY, 8));

    const loanA = await lend(inv, first.id, 1, { custodianId: admin.id, departmentId, hour: 10 });
    const loanB = await lend(inv, second.id, 1, { custodianId: admin.id, departmentId, hour: 11 });
    // Se devuelve SÓLO un equipo del primer préstamo; el segundo sigue vigente.
    await returnUnits(inv, loanA, 1, { custodianId: admin.id });

    const body = await monthSummary(inv, { typeId: scenario.type.id });
    expect(body.totals).toEqual({
      delivered: 2,
      returned: 1,
      admitted: 3,
      net: 1,
      distinctRecipients: 1,
      distinctDevices: 2,
      distinctLoans: 2,
      distinctReturns: 1,
      distinctMovements: 2,
    });
    expect(loanB.id).not.toBe(loanA.id);
  });

  test("prestar NO cuenta como incorporación (el movimiento LOAN no se suma)", async ({
    inv,
    scenario,
    departmentId,
  }) => {
    const admin = await adminUser();
    const device = await scenario.device(2);
    const stockInId = await stockInOf(device.id, at(PERIOD_DAY, 8));

    const beforeLend = await monthSummary(inv, { typeId: scenario.type.id });
    expect(beforeLend.totals.admitted).toBe(2);

    const loan = await lend(inv, device.id, 2, { custodianId: admin.id, departmentId });
    const afterLend = await monthSummary(inv, { typeId: scenario.type.id });
    expect(afterLend.totals.admitted).toBe(2);
    expect(afterLend.totals.delivered).toBe(2);

    // Tampoco lo cuenta la devolución (RETURN tampoco es incorporación).
    await returnUnits(inv, loan, 1, { custodianId: admin.id });
    const afterReturn = await monthSummary(inv, { typeId: scenario.type.id });
    expect(afterReturn.totals.admitted).toBe(2);
    expect(afterReturn.totals.returned).toBe(1);

    // Cancelar el movimiento de entrada sí lo saca de `admitted`.
    await db.movement.update({ where: { id: stockInId }, data: { status: "CANCELLED" } });
    const afterCancel = await monthSummary(inv, { typeId: scenario.type.id });
    expect(afterCancel.totals.admitted).toBe(0);
    expect(afterCancel.totals.delivered).toBe(2);
    expect(afterCancel.totals.distinctMovements).toBe(0);
  });

  test("una devolución de un préstamo de OTRO periodo baja el `net` de este", async ({
    inv,
    scenario,
    departmentId,
  }) => {
    const admin = await adminUser();
    const device = await scenario.device(1);
    await stockInOf(device.id, at(PERIOD_DAY, 8));
    const loan = await lend(inv, device.id, 1, { custodianId: admin.id, departmentId });
    await returnUnits(inv, loan, 1, { custodianId: admin.id });

    // La devolución se reagenda al mes siguiente: `returned` cae a 0 y el
    // `net` del mes de entrega sube, porque `net` es delta de responsabilidad.
    const loanReturn = await db.loanReturn.findFirstOrThrow({ where: { loanId: loan.id } });
    const later = at("2030-04-02", 9);
    await db.loanReturn.update({ where: { id: loanReturn.id }, data: { date: later } });
    await db.movement.update({ where: { id: loanReturn.movementId }, data: { date: later } });

    const march = await monthSummary(inv, { typeId: scenario.type.id });
    expect(march.totals).toMatchObject({ delivered: 1, returned: 0, net: 1 });

    const april = await monthSummary(inv, { typeId: scenario.type.id, date: "2030-04-02" });
    expect(april.totals).toMatchObject({ delivered: 0, returned: 1, net: -1 });
  });

  test("byPeriod: un bucket por día, sin repetidos, y la suma cuadra", async ({
    inv,
    scenario,
    departmentId,
  }) => {
    const admin = await adminUser();
    const first = await scenario.device(1);
    const second = await scenario.device(1);
    await stockInOf(first.id, at(PERIOD_DAY, 8));
    await stockInOf(second.id, at("2030-03-16", 8));
    const loanA = await lend(inv, first.id, 1, { custodianId: admin.id, departmentId, hour: 10 });
    await lend(inv, second.id, 1, { custodianId: admin.id, departmentId, dayKey: "2030-03-16" });
    await returnUnits(inv, loanA, 1, { custodianId: admin.id });

    const body = await monthSummary(inv, { typeId: scenario.type.id });
    const days = body.byPeriod.map((b) => b.day);
    expect(new Set(days).size).toBe(days.length);
    expect(days).toContain(PERIOD_DAY);
    // El préstamo del 16 conserva SU día: la entrega se fecha cuando ocurrió.
    expect(body.byPeriod.find((b) => b.day === "2030-03-16")?.delivered).toBe(1);
    // Todo bucket cae dentro del mes del periodo.
    expect(days.every((d) => d.startsWith(PERIOD_MONTH_PREFIX))).toBe(true);

    expect(body.byPeriod.reduce((acc, b) => acc + b.delivered, 0)).toBe(body.totals.delivered);
    expect(body.byPeriod.reduce((acc, b) => acc + b.returned, 0)).toBe(body.totals.returned);
    expect(body.byPeriod.reduce((acc, b) => acc + b.admitted, 0)).toBe(body.totals.admitted);
    expect(body.byPeriod.reduce((acc, b) => acc + b.net, 0)).toBe(body.totals.net);
  });

  test("byDevice: sin deviceId repetido, acumula y cuadra con los totales", async ({
    inv,
    scenario,
    departmentId,
  }) => {
    const admin = await adminUser();
    const device = await scenario.device(2);
    await stockInOf(device.id, at(PERIOD_DAY, 8));
    // Dos préstamos del MISMO equipo: el agregado suma, no queda con el último.
    await lend(inv, device.id, 1, { custodianId: admin.id, departmentId, hour: 10 });
    await lend(inv, device.id, 1, { custodianId: admin.id, departmentId, hour: 11 });

    const body = await monthSummary(inv, { typeId: scenario.type.id });
    const ids = body.byDevice.map((d) => d.deviceId);
    expect(new Set(ids).size).toBe(ids.length);
    expect(body.byDevice).toHaveLength(1);
    expect(body.byDevice[0]).toMatchObject({
      deviceId: device.id,
      description: device.name,
      typeId: scenario.type.id,
      typeName: scenario.type.name,
      delivered: 2,
      admitted: 2,
    });
    expect(body.byDevice[0].net).toBe(body.byDevice[0].delivered - body.byDevice[0].returned);
    expect(body.byDevice.reduce((acc, d) => acc + d.delivered, 0)).toBe(body.totals.delivered);
    expect(body.byDevice.reduce((acc, d) => acc + d.admitted, 0)).toBe(body.totals.admitted);
    expect(body.totals.distinctDevices).toBe(body.byDevice.length);
  });

  test("recipients: un elemento por custodio con sus datos resueltos", async ({
    inv,
    scenario,
    departmentId,
  }) => {
    const admin = await adminUser();
    // El agregado de recipients es "una fila por persona", así que su
    // departamento es el de la PERSONA (una misma persona puede recibir en
    // varios), no el del préstamo.
    const adminDepartment = admin.departmentId
      ? (await db.department.findUniqueOrThrow({ where: { id: admin.departmentId } })).name
      : null;
    const device = await scenario.device(2);
    await stockInOf(device.id, at(PERIOD_DAY, 8));
    const loan = await lend(inv, device.id, 2, { custodianId: admin.id, departmentId });
    await returnUnits(inv, loan, 1, { custodianId: admin.id });

    const body = await monthSummary(inv, { typeId: scenario.type.id });
    expect(body.recipients).toHaveLength(1);
    expect(body.recipients[0]).toMatchObject({
      userId: admin.id,
      name: admin.name,
      employeeNumber: admin.employeeNumber,
      departmentName: adminDepartment,
      loans: 1,
      delivered: 2,
      returned: 1,
      outstanding: 1,
    });
    expect(new Set(body.recipients.map((r) => r.userId)).size).toBe(body.recipients.length);
    expect(body.totals.distinctRecipients).toBe(body.recipients.length);
  });

  test("dos custodios distintos generan dos elementos en `recipients`", async ({
    inv,
    scenario,
    departmentId,
  }) => {
    const admin = await adminUser();
    const other = await employeeUser();
    const first = await scenario.device(1);
    const second = await scenario.device(1);
    await stockInOf(first.id, at(PERIOD_DAY, 8));
    await stockInOf(second.id, at(PERIOD_DAY, 8));
    await lend(inv, first.id, 1, { custodianId: admin.id, departmentId });
    await lend(inv, second.id, 1, { custodianId: other.id, departmentId });

    const body = await monthSummary(inv, { typeId: scenario.type.id });
    expect(body.recipients).toHaveLength(2);
    expect(body.recipients.map((r) => r.userId).sort()).toEqual([admin.id, other.id].sort());
    expect(body.totals.distinctRecipients).toBe(2);

    // Y el filtro por custodio deja sólo el suyo.
    const filtered = await monthSummary(inv, { typeId: scenario.type.id, custodianId: other.id });
    expect(filtered.recipients).toHaveLength(1);
    expect(filtered.recipients[0].userId).toBe(other.id);
    expect(filtered.totals).toMatchObject({ delivered: 1, distinctDevices: 1, distinctLoans: 1 });
    expect(filtered.filters).toEqual({
      typeId: scenario.type.id,
      departmentId: null,
      custodianId: other.id,
    });
  });

  test("el filtro de departamento reduce las TRES series", async ({
    inv,
    scenario,
    departmentId,
  }) => {
    const admin = await adminUser();
    const otherDept = await db.department.findFirstOrThrow({
      where: { id: { not: departmentId } },
    });
    const first = await scenario.device(1);
    const second = await scenario.device(1);
    await stockInOf(first.id, at(PERIOD_DAY, 8));
    await stockInOf(second.id, at(PERIOD_DAY, 8));
    await lend(inv, first.id, 1, { custodianId: admin.id, departmentId });
    await lend(inv, second.id, 1, { custodianId: admin.id, departmentId: otherDept.id });

    const all = await monthSummary(inv, { typeId: scenario.type.id });
    expect(all.totals.delivered).toBe(2);

    const byDepartment = await monthSummary(inv, { typeId: scenario.type.id, departmentId });
    expect(byDepartment.filters.departmentId).toBe(departmentId);
    // `admitted` se filtra por el movimiento, que no tiene departamento: el
    // filtro reduce las entregas, no las incorporaciones.
    expect(byDepartment.totals.delivered).toBe(1);
    expect(byDepartment.totals.distinctLoans).toBe(1);
    expect(byDepartment.recipients).toHaveLength(1);
    expect(byDepartment.byPeriod.reduce((acc, b) => acc + b.delivered, 0)).toBe(1);
    expect(byDepartment.byDevice.reduce((acc, d) => acc + d.delivered, 0)).toBe(1);
  });

  test("un periodo sin movimiento devuelve el conjunto vacío", async ({ inv, scenario }) => {
    const device = await scenario.device(1);
    // Su STOCK_IN se queda FUERA del periodo, así que el filtro es vacío.
    await stockInOf(device.id, at("2030-05-04", 8));
    const admin = await adminUser();

    const body = await monthSummary(inv, { typeId: scenario.type.id, custodianId: admin.id });
    expect(body.totals).toEqual(emptyTotals);
    expect(body.byPeriod).toEqual([]);
    expect(body.byDevice).toEqual([]);
    expect(body.recipients).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Buckets diarios en la zona del reporte
// ---------------------------------------------------------------------------

test.describe("REPORTES — buckets diarios", () => {
  test("00:30 y 23:30 locales del mismo día caen en el MISMO bucket", async ({ inv, scenario }) => {
    const early = await scenario.device(1);
    const late = await scenario.device(1);
    await stockInOf(early.id, at(PERIOD_DAY, 0, 30));
    await stockInOf(late.id, at(PERIOD_DAY, 23, 30));

    const body = await summaryOf(inv, { period: "DAY", date: PERIOD_DAY, typeId: scenario.type.id });
    expect(body.byPeriod).toEqual([
      { day: PERIOD_DAY, delivered: 0, returned: 0, admitted: 2, net: 0 },
    ]);
    expect(body.totals.admitted).toBe(2);
  });

  test("23:30 de un día y 00:30 del siguiente van a buckets DISTINTOS", async ({
    inv,
    scenario,
  }) => {
    const late = await scenario.device(1);
    const early = await scenario.device(1);
    await stockInOf(late.id, at("2030-03-14", 23, 30));
    await stockInOf(early.id, at("2030-03-15", 0, 30));

    const body = await summaryOf(inv, { period: "WEEK", date: PERIOD_DAY, typeId: scenario.type.id });
    expect(body.byPeriod).toEqual([
      { day: "2030-03-14", delivered: 0, returned: 0, admitted: 1, net: 0 },
      { day: "2030-03-15", delivered: 0, returned: 0, admitted: 1, net: 0 },
    ]);
    expect(body.totals.admitted).toBe(2);
  });

  test("el bucket se calcula en la zona pedida, no en la del servidor", async ({
    inv,
    scenario,
  }) => {
    // 02:00 UTC del 15 = 20:00 del 14 en UTC-6: el día local cambia.
    const device = await scenario.device(1);
    await stockInOf(device.id, new Date("2030-03-15T02:00:00.000Z"));

    const typeId = scenario.type.id;
    const inUtc = await summaryOf(inv, { period: "DAY", date: "2030-03-15", timezone: "UTC", typeId });
    expect(inUtc.byPeriod.map((b) => b.day)).toEqual(["2030-03-15"]);

    const inMexico = await summaryOf(inv, {
      period: "DAY",
      date: "2030-03-14",
      timezone: "America/Mexico_City",
      typeId,
    });
    expect(inMexico.byPeriod.map((b) => b.day)).toEqual(["2030-03-14"]);
    expect(inMexico.totals.admitted).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Detalle de entregas
// ---------------------------------------------------------------------------

test.describe("REPORTES — detalle de entregas", () => {
  test("`detailLimit` acota filas y avisa el truncamiento", async ({
    inv,
    scenario,
    departmentId,
  }) => {
    const admin = await adminUser();
    const first = await scenario.device(1);
    const second = await scenario.device(1);
    await stockInOf(first.id, at(PERIOD_DAY, 8));
    await stockInOf(second.id, at(PERIOD_DAY, 8));
    const loanA = await lend(inv, first.id, 1, { custodianId: admin.id, departmentId, hour: 10 });
    const loanB = await lend(inv, second.id, 1, { custodianId: admin.id, departmentId, hour: 11 });
    const scope = { typeId: scenario.type.id };

    const full = await detailOf(inv, { period: "MONTH", date: PERIOD_MONTH, detailLimit: 10, ...scope });
    expect(full.total).toBe(2);
    expect(full.data).toHaveLength(2);
    expect(full.truncated).toBe(false);

    const short = await detailOf(inv, { period: "MONTH", date: PERIOD_MONTH, detailLimit: 1, ...scope });
    expect(short.total).toBe(2);
    expect(short.data).toHaveLength(1);
    expect(short.truncated).toBe(true);
    expect(short.data[0].number).toBe(loanB.number);

    // Orden descendente por fecha de entrega.
    const dates = full.data.map((r) => new Date(r.date).getTime());
    expect(dates).toEqual([...dates].sort((a, b) => b - a));
    expect(full.data.map((r) => r.number)).toContain(loanA.number);
    expect(full.data.every((r) => r.status === "ACTIVE")).toBe(true);
  });

  test("sin `detailLimit` el tope por defecto trae todo el conjunto", async ({
    inv,
    scenario,
    departmentId,
  }) => {
    const admin = await adminUser();
    const device = await scenario.device(3);
    await stockInOf(device.id, at(PERIOD_DAY, 8));
    const loan = await lend(inv, device.id, 3, { custodianId: admin.id, departmentId });

    const body = await detailOf(inv, { period: "MONTH", date: PERIOD_MONTH, typeId: scenario.type.id });
    // Un ítem de 3 unidades = UNA fila con quantity 3, no tres filas.
    expect(body.data).toHaveLength(1);
    expect(body.data[0]).toMatchObject({
      number: loan.number,
      deviceId: device.id,
      description: device.name,
      custodianName: admin.name,
      employeeNumber: admin.employeeNumber,
      quantity: 3,
      returnedQuantity: 0,
      status: "ACTIVE",
      returnDate: null,
      returnNumber: null,
    });
    expect(body.total).toBe(1);
    expect(body.truncated).toBe(false);
  });

  test("returnDate y returnNumber son los de la devolución, no los del préstamo", async ({
    inv,
    scenario,
    departmentId,
  }) => {
    const admin = await adminUser();
    const device = await scenario.device(1);
    await stockInOf(device.id, at(PERIOD_DAY, 8));
    const loan = await lend(inv, device.id, 1, { custodianId: admin.id, departmentId, hour: 10 });
    const { loanReturn, returnDate } = await returnUnits(inv, loan, 1, {
      custodianId: admin.id,
    });

    const body = await detailOf(inv, { period: "MONTH", date: PERIOD_MONTH, typeId: scenario.type.id });
    const row = body.data.find((r) => r.number === loan.number);
    expect(row).toMatchObject({
      status: "RETURNED",
      returnedQuantity: 1,
      returnNumber: loanReturn.number,
    });
    expect(new Date(row!.returnDate!).getTime()).toBe(returnDate.getTime());
    // La fecha del préstamo es otra distinta: no se confunden.
    expect(new Date(row!.date).getTime()).toBe(at(PERIOD_DAY, 10).getTime());
    expect(new Date(row!.returnDate!).getTime()).toBeGreaterThan(new Date(row!.date).getTime());
  });

  test("devolución parcial: PARTIAL y una sola fila por ítem", async ({
    inv,
    scenario,
    departmentId,
  }) => {
    const admin = await adminUser();
    const device = await scenario.device(2);
    await stockInOf(device.id, at(PERIOD_DAY, 8));
    const loan = await lend(inv, device.id, 2, { custodianId: admin.id, departmentId });
    expect(loan.items).toHaveLength(1);
    await returnUnits(inv, loan, 1, { custodianId: admin.id });

    const body = await detailOf(inv, { period: "MONTH", date: PERIOD_MONTH, typeId: scenario.type.id });
    const rows = body.data.filter((r) => r.number === loan.number);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ quantity: 2, returnedQuantity: 1, status: "PARTIAL" });
    expect(body.total).toBe(1);
  });

  test("un préstamo CANCELLED desaparece de las tres series y del detalle", async ({
    inv,
    scenario,
    departmentId,
  }) => {
    const admin = await adminUser();
    const device = await scenario.device(1);
    await stockInOf(device.id, at(PERIOD_DAY, 8));
    const loan = await lend(inv, device.id, 1, { custodianId: admin.id, departmentId });
    const scope = { typeId: scenario.type.id };

    const before = await monthSummary(inv, scope);
    expect(before.totals.delivered).toBe(1);
    expect((await detailOf(inv, { period: "MONTH", date: PERIOD_MONTH, ...scope })).total).toBe(1);

    await inv.cancelLoan(loan.id);
    expect((await db.loan.findUniqueOrThrow({ where: { id: loan.id } })).status).toBe("CANCELLED");

    const after = await monthSummary(inv, scope);
    expect(after.totals).toEqual({
      ...before.totals,
      delivered: 0,
      net: 0,
      distinctLoans: 0,
      distinctRecipients: 0,
    });
    expect(after.recipients).toEqual([]);
    expect(after.byDevice[0]).toMatchObject({ delivered: 0, returned: 0, net: 0 });
    const detail = await detailOf(inv, { period: "MONTH", date: PERIOD_MONTH, ...scope });
    expect(detail.total).toBe(0);
    expect(detail.data).toEqual([]);
    expect(detail.truncated).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Tabla de entregas del periodo (server-side)
// ---------------------------------------------------------------------------

/** Cuerpo de tabla del periodo: los filtros viajan DENTRO de `filters`. */
const deliveriesBody = (
  filters: Record<string, unknown> = {},
  extra: Record<string, unknown> = {}
): Record<string, unknown> => ({
  page: 1,
  limit: 100,
  filters: { period: "MONTH", date: PERIOD_MONTH, timezone: TZ, ...filters },
  ...extra,
});

const deliveriesOf = async (
  inv: InventoryApi,
  filters: Record<string, unknown> = {},
  extra: Record<string, unknown> = {}
): Promise<TableMeta & { data: DeliveryDetailRow[]; total: number }> => {
  const res = await inv.post<TableMeta & { data: DeliveryDetailRow[]; total: number }>(
    "/reports/period-summary/deliveries",
    deliveriesBody(filters, extra)
  );
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body;
};

/** Tres préstamos del mismo día y tipo: base de paginación, orden y filtros. */
const threeLoans = async (
  inv: InventoryApi,
  scenario: Scenario,
  opts: { custodianId: string; departmentId: string }
) => {
  const first = await scenario.device(1);
  const second = await scenario.device(2);
  const third = await scenario.device(3);
  await stockInOf(first.id, at(PERIOD_DAY, 8));
  await stockInOf(second.id, at(PERIOD_DAY, 8));
  await stockInOf(third.id, at(PERIOD_DAY, 8));
  const loans = [
    await lend(inv, first.id, 1, { ...opts, hour: 9 }),
    await lend(inv, second.id, 2, { ...opts, hour: 10 }),
    await lend(inv, third.id, 3, { ...opts, hour: 11 }),
  ];
  return { devices: [first, second, third], loans };
};

test.describe("REPORTE DE PERIODO — tabla de entregas", () => {
  test("devuelve página paginada y `total` cuadra con el detalle del mismo filtro", async ({
    inv,
    scenario,
    departmentId,
  }) => {
    const admin = await adminUser();
    await threeLoans(inv, scenario, { custodianId: admin.id, departmentId });
    const scope = { typeId: scenario.type.id };

    const page = await deliveriesOf(inv, scope);
    const detail = await detailOf(inv, { period: "MONTH", date: PERIOD_MONTH, ...scope });

    expect(page.total).toBe(detail.total);
    expect(page.total).toBe(3);
    expect(page.totalPages).toBe(1);
    expect(page.hasNextPage).toBe(false);
    expect(page.hasPreviousPage).toBe(false);
    expect(page.page).toBe(1);
    expect(page.pageIndex).toBe(0);
    // Mismas filas que el universo del PDF: mismo mapper, mismo `select`.
    expect(page.data).toEqual(detail.data);
  });

  test("paginar no repite ni pierde filas", async ({ inv, scenario, departmentId }) => {
    const admin = await adminUser();
    await threeLoans(inv, scenario, { custodianId: admin.id, departmentId });
    const scope = { typeId: scenario.type.id };

    const first = await deliveriesOf(inv, scope, { page: 1, limit: 2 });
    const second = await deliveriesOf(inv, scope, { page: 2, limit: 2 });

    expect(first.data).toHaveLength(2);
    expect(first.totalPages).toBe(2);
    expect(first.hasNextPage).toBe(true);
    expect(second.data).toHaveLength(1);
    expect(second.hasPreviousPage).toBe(true);
    expect(second.hasNextPage).toBe(false);

    const ids = [...first.data, ...second.data].map((r) => r.id);
    expect(new Set(ids).size).toBe(3);
  });

  test("orden por defecto `date desc`, por columna y estable ante una llave desconocida", async ({
    inv,
    scenario,
    departmentId,
  }) => {
    const admin = await adminUser();
    await threeLoans(inv, scenario, { custodianId: admin.id, departmentId });
    const scope = { typeId: scenario.type.id };

    const byDate = await deliveriesOf(inv, scope);
    const dates = byDate.data.map((r) => new Date(r.date).getTime());
    expect(dates).toEqual([...dates].sort((a, b) => b - a));

    const byQuantity = await deliveriesOf(inv, scope, {
      sort: { key: "quantity", direction: "desc" },
    });
    expect(byQuantity.data.map((r) => r.quantity)).toEqual([3, 2, 1]);

    // Llave fuera del allowlist: cae al orden estable, no a un error ni a otro.
    const unknown = await deliveriesOf(inv, scope, {
      sort: { key: "no-existe", direction: "asc" },
    });
    expect(unknown.data.map((r) => r.id)).toEqual(byDate.data.map((r) => r.id));

    // `status` NO es ordenable: es derivado, y también cae al orden estable.
    const byStatus = await deliveriesOf(inv, scope, {
      sort: { key: "status", direction: "asc" },
    });
    expect(byStatus.data.map((r) => r.id)).toEqual(byDate.data.map((r) => r.id));
  });

  test("filtro `q` busca por folio, por equipo y por custodio", async ({
    inv,
    scenario,
    departmentId,
  }) => {
    const admin = await adminUser();
    const { devices, loans } = await threeLoans(inv, scenario, {
      custodianId: admin.id,
      departmentId,
    });
    const scope = { typeId: scenario.type.id };

    const byFolio = await deliveriesOf(inv, { ...scope, q: loans[1].number });
    expect(byFolio.total).toBe(1);
    expect(byFolio.data[0].number).toBe(loans[1].number);

    const byDevice = await deliveriesOf(inv, { ...scope, q: devices[2].name });
    expect(byDevice.total).toBe(1);
    expect(byDevice.data[0].deviceId).toBe(devices[2].id);

    const byCustodian = await deliveriesOf(inv, { ...scope, q: admin.name });
    expect(byCustodian.total).toBe(3);

    // El folio no debe aparecer en la búsqueda por equipo: son columnas distintas.
    const cross = await deliveriesOf(inv, { ...scope, q: `${loans[0].number}-equipo` });
    expect(cross.total).toBe(0);
  });

  test("filtro `status` reproduce el estado del mapper: ACTIVE / PARTIAL / RETURNED", async ({
    inv,
    scenario,
    departmentId,
  }) => {
    const admin = await adminUser();
    const active = await scenario.device(1);
    const partial = await scenario.device(2);
    const returned = await scenario.device(1);
    for (const d of [active, partial, returned]) {
      await stockInOf(d.id, at(PERIOD_DAY, 8));
    }
    const scope = { typeId: scenario.type.id };
    const loanActive = await lend(inv, active.id, 1, { custodianId: admin.id, departmentId });
    const loanPartial = await lend(inv, partial.id, 2, { custodianId: admin.id, departmentId });
    const loanReturned = await lend(inv, returned.id, 1, { custodianId: admin.id, departmentId });
    await returnUnits(inv, loanPartial, 1, { custodianId: admin.id });
    await returnUnits(inv, loanReturned, 1, { custodianId: admin.id });

    const all = await deliveriesOf(inv, scope);
    expect(all.total).toBe(3);

    const onlyActive = await deliveriesOf(inv, { ...scope, status: "ACTIVE" });
    expect(onlyActive.total).toBe(1);
    expect(onlyActive.data.map((r) => r.number)).toEqual([loanActive.number]);

    const onlyPartial = await deliveriesOf(inv, { ...scope, status: "PARTIAL" });
    expect(onlyPartial.total).toBe(1);
    expect(onlyPartial.data[0]).toMatchObject({
      number: loanPartial.number,
      quantity: 2,
      returnedQuantity: 1,
    });

    const onlyReturned = await deliveriesOf(inv, { ...scope, status: "RETURNED" });
    expect(onlyReturned.total).toBe(1);
    expect(onlyReturned.data[0]).toMatchObject({
      number: loanReturned.number,
      returnedQuantity: 1,
      status: "RETURNED",
    });

    // Los tres conjuntos juntos son el universo, sin repetir ni soltar filas.
    const union = [
      ...onlyActive.data,
      ...onlyPartial.data,
      ...onlyReturned.data,
    ].map((r) => r.id);
    expect(new Set(union).size).toBe(3);
  });

  test("los filtros de periodo reducen `data` y `total` como reducen los totales", async ({
    inv,
    scenario,
    departmentId,
  }) => {
    const admin = await adminUser();
    const other = await employeeUser();
    const mine = await scenario.device(1);
    const theirs = await scenario.device(1);
    await stockInOf(mine.id, at(PERIOD_DAY, 8));
    await stockInOf(theirs.id, at(PERIOD_DAY, 8));
    const myLoan = await lend(inv, mine.id, 1, { custodianId: admin.id, departmentId });
    const theirLoan = await lend(inv, theirs.id, 1, { custodianId: other.id, departmentId });

    const scope = { typeId: scenario.type.id };
    expect((await deliveriesOf(inv, scope)).total).toBe(2);

    const summary = await monthSummary(inv, scope);
    expect(summary.totals.distinctLoans).toBe(2);

    const byType = await deliveriesOf(inv, { typeId: scenario.type.id });
    expect(byType.total).toBe(2);

    const byCustodian = await deliveriesOf(inv, { ...scope, custodianId: admin.id });
    expect(byCustodian.total).toBe(1);
    expect(byCustodian.data[0].number).toBe(myLoan.number);
    expect((await monthSummary(inv, { ...scope, custodianId: admin.id })).totals.delivered).toBe(1);

    const byOther = await deliveriesOf(inv, { ...scope, custodianId: other.id });
    expect(byOther.total).toBe(1);
    expect(byOther.data[0].number).toBe(theirLoan.number);

    // Un departamento que no participa deja el conjunto vacío, no `null`.
    const empty = await db.department.findFirstOrThrow({ where: { id: { not: departmentId } } });
    const byDepartment = await deliveriesOf(inv, { ...scope, departmentId: empty.id });
    expect(byDepartment.total).toBe(0);
    expect(byDepartment.data).toEqual([]);
  });

  test("permisos: 401 sin token, 403 sin `reports.view`, y `view` alcanza `/deliveries`", async ({
    inv,
    invAnonymous,
    invEmployee,
  }) => {
    const body = deliveriesBody();

    const anon = await invAnonymous.post("/reports/period-summary/deliveries", body);
    expect(anon.status).toBe(401);

    const employee = await invEmployee.post("/reports/period-summary/deliveries", body);
    expect(employee.status).toBe(403);

    // El detalle (universo del PDF) sigue exigiendo `reports.export`.
    const detailForEmployee = await invEmployee.post("/reports/period-summary/detail", {
      period: "MONTH",
      date: PERIOD_MONTH,
      timezone: TZ,
    });
    expect(detailForEmployee.status).toBe(403);
    expect((await inv.post("/reports/period-summary/deliveries", body)).status).toBe(200);
  });

  test("`limit` fuera de 1..100 es 400; los bordes válidos entran", async ({
    inv,
    scenario,
    departmentId,
  }) => {
    const admin = await adminUser();
    await threeLoans(inv, scenario, { custodianId: admin.id, departmentId });
    const scope = { typeId: scenario.type.id };

    // POR QUÉ 400 (y no un recorte silencioso): `parseTableParams` valida el
    // CUERPO COMPLETO con `safeParse`; un `limit` fuera de rango lo invalida
    // entero y cae al cuerpo `{}` — filtros incluidos. Sin `date` el periodo no
    // se puede resolver, así que `resolveRange` responde 400. Las
    // instantáneas no lo notan porque su `where` no depende del periodo.
    for (const limit of [0, 500, -3]) {
      const res = await inv.post<{ error: string; code: string }>(
        "/reports/period-summary/deliveries",
        deliveriesBody(scope, { limit })
      );
      expect(res.status, `limit ${limit} debe ser 400`).toBe(400);
      expect(res.body.code).toBe("INVALID_REPORT_DATE");
    }

    for (const limit of [1, 100]) {
      const res = await deliveriesOf(inv, scope, { limit });
      expect(res.limit).toBe(limit);
      expect(res.total).toBe(3);
    }
  });

  test("el borde `end` exclusivo no entra: un préstamo en `range.end` no aparece", async ({
    inv,
    scenario,
    departmentId,
  }) => {
    const admin = await adminUser();
    const inside = await scenario.device(1);
    const onTheEdge = await scenario.device(1);
    await stockInOf(inside.id, at(PERIOD_DAY, 8));
    await stockInOf(onTheEdge.id, at(PERIOD_DAY, 8));
    await lend(inv, inside.id, 1, { custodianId: admin.id, departmentId });
    const scope = { typeId: scenario.type.id };

    const summary = await monthSummary(inv, scope);
    expect(summary.totals.delivered).toBe(1);
    expect((await deliveriesOf(inv, scope)).total).toBe(1);

    // El primer instante del mes siguiente ES `range.end`: no pertenece al mes,
    // ni al resumen ni a la tabla.
    const end = new Date(summary.range.end);
    await lend(inv, onTheEdge.id, 1, {
      custodianId: admin.id,
      departmentId,
      dayKey: localDateKey(end, TZ),
      hour: end.getUTCHours(),
      minute: 0,
    });

    expect((await monthSummary(inv, scope)).totals.delivered).toBe(1);
    expect((await deliveriesOf(inv, scope)).total).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Instantáneas server-side
// ---------------------------------------------------------------------------

test.describe("REPORTES — instantáneas server-side", () => {
  test("assigned-devices y devices devuelven página + stats coherentes", async ({
    inv,
    scenario,
    departmentId,
  }) => {
    const admin = await adminUser();
    const dept = await db.department.findUniqueOrThrow({ where: { id: departmentId } });
    const device = await scenario.device(2);
    const units = await inv.units(device.id);
    const [loaned, free] = units;

    // Antes de prestar: 2 unidades disponibles y 0 asignadas.
    const fresh = await inv.post<TableResponse<DeviceReportRow>>("/reports/devices", {
      page: 1,
      limit: 10,
      filters: { typeId: scenario.type.id },
    });
    expect(fresh.status).toBe(200);
    expect(fresh.body.total).toBe(2);
    expect(fresh.body.stats).toMatchObject({ total: 2, available: 2, assigned: 0, retired: 0 });
    expect(fresh.body.data.map((r) => r.status)).toEqual(["AVAILABLE", "AVAILABLE"]);

    // Se presta 1 de las 2: queda 1 libre y 1 asignada.
    const loan = await lend(inv, device.id, 1, { custodianId: admin.id, departmentId });

    const assigned = await inv.post<TableResponse<AssignedDeviceRow>>("/reports/assigned-devices", {
      page: 1,
      limit: 10,
      filters: { typeId: scenario.type.id },
    });
    expect(assigned.status).toBe(200);
    expect(assigned.body).toMatchObject({
      page: 1,
      pageIndex: 0,
      limit: 10,
      total: 1,
      totalCount: 1,
      hasPreviousPage: false,
      hasNextPage: false,
    });
    const assignedStats = assigned.body.stats as AssignedStats;
    expect(assignedStats.assigned).toBe(1);
    expect(assignedStats.averageDays).toBeGreaterThanOrEqual(0);
    expect(assignedStats.over30).toBe(0);
    expect(assigned.body.data).toHaveLength(1);
    expect(assigned.body.data[0]).toMatchObject({
      assetTag: loaned.assetTag,
      description: device.name,
      type: scenario.type.name,
      custodian: admin.name,
      employeeNumber: admin.employeeNumber,
      department: dept.name,
      folio: loan.number,
    });
    expect(assigned.body.data[0].daysAssigned).not.toBeNull();

    // Inventario: `ON_LOAN` sale normalizado como `ASSIGNED`, junto a la libre.
    const devices = await inv.post<TableResponse<DeviceReportRow>>("/reports/devices", {
      page: 1,
      limit: 10,
      filters: { typeId: scenario.type.id },
    });
    expect(devices.body.total).toBe(2);
    expect(devices.body.stats).toMatchObject({ total: 2, available: 1, assigned: 1 });
    const statuses = devices.body.data.map((r) => r.status).sort();
    expect(statuses).toEqual(["ASSIGNED", "AVAILABLE"]);
    expect(devices.body.data.find((r) => r.status === "ASSIGNED")).toMatchObject({
      assetTag: loaned.assetTag,
      custodian: admin.name,
      folio: loan.number,
    });
    expect(devices.body.data.find((r) => r.status === "AVAILABLE")?.assetTag).toBe(free.assetTag);
  });

  test("`stats` se calculan sobre el conjunto FILTRADO, no sobre el universo", async ({
    inv,
    scenario,
    departmentId,
  }) => {
    const admin = await adminUser();
    const device = await scenario.device(3);
    await lend(inv, device.id, 2, { custodianId: admin.id, departmentId });
    const scope = { page: 1, limit: 50, filters: { typeId: scenario.type.id } };

    const all = await inv.post<TableResponse<DeviceReportRow>>("/reports/devices", scope);
    const available = await inv.post<TableResponse<DeviceReportRow>>("/reports/devices", {
      ...scope,
      filters: { ...scope.filters, status: "AVAILABLE" },
    });
    const assigned = await inv.post<TableResponse<DeviceReportRow>>("/reports/devices", {
      ...scope,
      filters: { ...scope.filters, status: "ASSIGNED" },
    });

    expect((all.body.stats as DevicesStats).total).toBe(3);
    expect((all.body.stats as DevicesStats).assigned).toBe(2);
    // Filtrar por estado NO deja los KPIs del universo: son los del conjunto.
    expect(available.body.total).toBe(1);
    expect(available.body.stats).toMatchObject({ total: 1, available: 1, assigned: 0 });
    expect(available.body.data.every((r) => r.status === "AVAILABLE")).toBe(true);
    expect(assigned.body.total).toBe(2);
    expect(assigned.body.stats).toMatchObject({ total: 2, available: 0, assigned: 2 });
    expect(assigned.body.data.every((r) => r.status === "ASSIGNED")).toBe(true);
  });

  test("los export traen el universo filtrado con los mismos stats que la tabla", async ({
    inv,
    scenario,
    departmentId,
  }) => {
    const admin = await adminUser();
    const device = await scenario.device(3);
    await lend(inv, device.id, 1, { custodianId: admin.id, departmentId });
    const body = { page: 1, limit: 2, filters: { typeId: scenario.type.id } };

    const table = await inv.post<TableResponse<AssignedDeviceRow>>("/reports/assigned-devices", body);
    const assignedExport = await inv.post<ExportResponse<AssignedDeviceRow>>(
      "/reports/assigned-devices/export",
      body
    );
    expect(assignedExport.status).toBe(200);
    expect(assignedExport.body.total).toBe(table.body.total);
    expect(assignedExport.body.stats).toEqual(table.body.stats);
    expect(assignedExport.body.truncated).toBe(false);
    // El export NO pagina: trae todo el universo filtrado, no la página.
    expect(assignedExport.body.data).toHaveLength(assignedExport.body.total);
    expect(assignedExport.body.total).toBe(1);

    const deviceTable = await inv.post<TableResponse<DeviceReportRow>>("/reports/devices", body);
    const deviceExport = await inv.post<ExportResponse<DeviceReportRow>>(
      "/reports/devices/export",
      body
    );
    expect(deviceExport.status).toBe(200);
    expect(deviceExport.body.total).toBe(deviceTable.body.total);
    expect(deviceExport.body.stats).toEqual(deviceTable.body.stats);
    expect(deviceExport.body.truncated).toBe(false);
    expect(deviceExport.body.data).toHaveLength(3);
    expect(deviceExport.body.data.map((r) => r.status).sort()).toEqual([
      "ASSIGNED",
      "AVAILABLE",
      "AVAILABLE",
    ]);
  });

  test("el filtro por columna reduce `total` y todas las filas lo cumplen", async ({
    inv,
    scenario,
    departmentId,
  }) => {
    const admin = await adminUser();
    const mine = await scenario.device(2);
    const other = await scenario.device(1);
    const [otherUnit] = await inv.units(other.id);
    await lend(inv, mine.id, 1, { custodianId: admin.id, departmentId });
    await lend(inv, other.id, 1, { custodianId: admin.id, departmentId });

    const unfiltered = await inv.post<TableResponse<AssignedDeviceRow>>("/reports/assigned-devices", {
      page: 1,
      limit: 100,
      filters: {},
    });
    const byCustodian = await inv.post<TableResponse<AssignedDeviceRow>>(
      "/reports/assigned-devices",
      { page: 1, limit: 100, filters: { custodian: admin.name } }
    );
    expect(byCustodian.status).toBe(200);
    expect(byCustodian.body.total).toBeLessThan(unfiltered.body.total);
    expect(byCustodian.body.total).toBeGreaterThanOrEqual(2);
    expect(byCustodian.body.data.every((r) => r.custodian === admin.name)).toBe(true);
    expect(byCustodian.body.data.map((r) => r.assetTag)).toContain(otherUnit.assetTag);

    // El texto del filtro es case-insensitive.
    const lower = await inv.post<TableResponse<AssignedDeviceRow>>("/reports/assigned-devices", {
      page: 1,
      limit: 100,
      filters: { custodian: admin.name.toLowerCase() },
    });
    expect(lower.body.total).toBe(byCustodian.body.total);

    // Activo fijo exacto deja una sola fila.
    const [loaned] = await inv.units(mine.id);
    const byTag = await inv.post<TableResponse<AssignedDeviceRow>>("/reports/assigned-devices", {
      page: 1,
      limit: 10,
      filters: { assetTag: loaned.assetTag },
    });
    expect(byTag.body.total).toBe(1);
    expect(byTag.body.data[0].assetTag).toBe(loaned.assetTag);
    expect(byTag.body.data[0].folio).toBeTruthy();
  });

  test("el filtro `folio` busca por número de carta y `q` barre texto", async ({
    inv,
    scenario,
    departmentId,
  }) => {
    const admin = await adminUser();
    const first = await scenario.device(1);
    const second = await scenario.device(1);
    await lend(inv, first.id, 1, { custodianId: admin.id, departmentId });
    const loan = await lend(inv, second.id, 1, { custodianId: admin.id, departmentId });

    const byFolio = await inv.post<TableResponse<AssignedDeviceRow>>("/reports/assigned-devices", {
      page: 1,
      limit: 10,
      filters: { typeId: scenario.type.id, folio: loan.number },
    });
    expect(byFolio.status).toBe(200);
    expect(byFolio.body.total).toBe(1);
    expect(byFolio.body.data[0].folio).toBe(loan.number);

    // `q` también encuentra por activo fijo y por responsable.
    const [unit] = await inv.units(first.id);
    const byQ = await inv.post<TableResponse<AssignedDeviceRow>>("/reports/assigned-devices", {
      page: 1,
      limit: 10,
      filters: { typeId: scenario.type.id, q: unit.assetTag },
    });
    expect(byQ.body.total).toBe(1);
    const byCustodian = await inv.post<TableResponse<AssignedDeviceRow>>(
      "/reports/assigned-devices",
      { page: 1, limit: 10, filters: { typeId: scenario.type.id, q: admin.name } }
    );
    expect(byCustodian.body.total).toBe(2);
  });

  test("`sort` se resuelve en el servidor para las columnas del allowlist", async ({
    inv,
    scenario,
    departmentId,
  }) => {
    const admin = await adminUser();
    const device = await scenario.device(3);
    await lend(inv, device.id, 3, { custodianId: admin.id, departmentId });
    const scope = { page: 1, limit: 10, filters: { typeId: scenario.type.id } };

    const asc = await inv.post<TableResponse<AssignedDeviceRow>>("/reports/assigned-devices", {
      ...scope,
      sort: { key: "assetTag", direction: "asc" },
    });
    const desc = await inv.post<TableResponse<AssignedDeviceRow>>("/reports/assigned-devices", {
      ...scope,
      sort: { key: "assetTag", direction: "desc" },
    });
    expect(asc.status).toBe(200);
    expect(desc.status).toBe(200);
    expect(asc.body.total).toBe(3);
    expect(asc.body.data).toHaveLength(3);

    const ascTags = asc.body.data.map((r) => r.assetTag);
    const descTags = desc.body.data.map((r) => r.assetTag);
    expect([...ascTags].sort()).toEqual(ascTags);
    expect([...descTags].sort().reverse()).toEqual(descTags);
    expect(ascTags).toEqual([...descTags].reverse());

    // Descripción también es ordenable (relación a-uno del lote).
    const byDescription = await inv.post<TableResponse<DeviceReportRow>>("/reports/devices", {
      ...scope,
      sort: { key: "description", direction: "asc" },
    });
    expect(byDescription.status).toBe(200);
    expect(byDescription.body.data).toHaveLength(3);
  });

  test("una clave fuera del allowlist cae al orden estable documentado", async ({
    inv,
    scenario,
    departmentId,
  }) => {
    const admin = await adminUser();
    await lend(inv, (await scenario.device(2)).id, 1, { custodianId: admin.id, departmentId });
    const scope = { page: 1, limit: 50, filters: { typeId: scenario.type.id } };

    // `custodian`, `daysAssigned` y `date` viven en el préstamo de una relación
    // a-many: Prisma no las puede ordenar conservando `DeviceUnit` como base. El
    // allowlist las ignora y la tabla conserva `assetTag asc`.
    const fallback = await inv.post<TableResponse<AssignedDeviceRow>>(
      "/reports/assigned-devices",
      { ...scope, sort: { key: "daysAssigned", direction: "desc" } }
    );
    const stable = await inv.post<TableResponse<AssignedDeviceRow>>("/reports/assigned-devices", scope);
    const unknown = await inv.post<TableResponse<AssignedDeviceRow>>("/reports/assigned-devices", {
      ...scope,
      sort: { key: "columnaInventada", direction: "desc" },
    });
    expect(fallback.status).toBe(200);
    expect(fallback.body.data.map((r) => r.assetTag)).toEqual(
      stable.body.data.map((r) => r.assetTag)
    );
    expect(unknown.body.data.map((r) => r.assetTag)).toEqual(
      stable.body.data.map((r) => r.assetTag)
    );
    // El fallback NO es un "primeras N": el conjunto sigue completo.
    expect(fallback.body.total).toBe(stable.body.total);
  });

  test("la paginación no pierde ni repite filas entre páginas", async ({
    inv,
    scenario,
    departmentId,
  }) => {
    const admin = await adminUser();
    const device = await scenario.device(5);
    await lend(inv, device.id, 5, { custodianId: admin.id, departmentId });
    const scope = {
      filters: { typeId: scenario.type.id },
      sort: { key: "assetTag", direction: "asc" },
    };

    const first = await inv.post<TableResponse<AssignedDeviceRow>>("/reports/assigned-devices", {
      ...scope,
      page: 1,
      limit: 2,
    });
    const second = await inv.post<TableResponse<AssignedDeviceRow>>("/reports/assigned-devices", {
      ...scope,
      page: 2,
      limit: 2,
    });
    const third = await inv.post<TableResponse<AssignedDeviceRow>>("/reports/assigned-devices", {
      ...scope,
      page: 3,
      limit: 2,
    });

    expect(first.body.total).toBe(5);
    expect(first.body.totalPages).toBe(3);
    expect(first.body.data).toHaveLength(2);
    expect(second.body.data).toHaveLength(2);
    expect(third.body.data).toHaveLength(1);
    expect(first.body.hasPreviousPage).toBe(false);
    expect(first.body.hasNextPage).toBe(true);
    expect(second.body.hasPreviousPage).toBe(true);
    expect(third.body.hasPreviousPage).toBe(true);
    expect(third.body.hasNextPage).toBe(false);

    const all = [...first.body.data, ...second.body.data, ...third.body.data].map((r) => r.assetTag);
    expect(new Set(all).size).toBe(5);
    expect([...all].sort()).toEqual(all);
  });
});

// ---------------------------------------------------------------------------
// Reporte de entregas (regresión del endpoint existente)
// ---------------------------------------------------------------------------

test.describe("REPORTES — reporte de entregas", () => {
  test("POST /reports/query pagina con el sobre de tabla y filtra por custodio", async ({
    inv,
    scenario,
    departmentId,
  }) => {
    const admin = await adminUser();
    const device = await scenario.device(2);
    await stockInOf(device.id, at(PERIOD_DAY, 8));
    const loan = await lend(inv, device.id, 2, { custodianId: admin.id, departmentId });

    // `limit: 100` (el tope) y no una página corta: este filtro no acota por
    // tipo de equipo, así que la fila de este test compite en el MISMO universo
    // que dejaron los tests anteriores del run (la limpieza es global, al
    // final). Con una página de 20 la prueba se volvía roja según cuántos
    // préstamos crean los tests que corren antes.
    const body = await inv.post<TableResponse<DeliveryReportRow>>("/reports/query", {
      page: 1,
      limit: 100,
      filters: { employee: admin.name, start: PERIOD_DAY, end: PERIOD_DAY },
    });
    expect(body.status).toBe(200);
    expect(body.body.limit).toBe(100);
    expect(body.body.total).toBeGreaterThanOrEqual(1);
    expect(body.body.data.every((r) => r.responsible === admin.name)).toBe(true);
    const row = body.body.data.find((r) => r.document_code === loan.number);
    expect(row).toBeDefined();
    // Un ítem = una fila, con la cantidad una sola vez.
    expect(row).toMatchObject({
      document_code: loan.number,
      responsible: admin.name,
      employee_no: admin.employeeNumber,
      quantity: 2,
      status: "ACTIVE",
      return_date: null,
    });
    expect(row!.asset_code).toContain(",");
  });
});

// ---------------------------------------------------------------------------
// Errores y permisos
// ---------------------------------------------------------------------------

test.describe("REPORTES — errores y permisos", () => {
  const NEW_ROUTES = [
    "/reports/period-summary",
    "/reports/period-summary/deliveries",
    "/reports/period-summary/detail",
    "/reports/assigned-devices",
    "/reports/assigned-devices/export",
    "/reports/devices",
    "/reports/devices/export",
  ];

  const periodBody = { period: "MONTH", date: PERIOD_MONTH, timezone: TZ, filters: {} };

  test("sin token las rutas nuevas responden 401", async ({ invAnonymous }) => {
    for (const path of NEW_ROUTES) {
      const res = await invAnonymous.post(path, periodBody);
      expect(res.status, `${path} debe pedir token`).toBe(401);
    }
  });

  test("un rol sin reports.view recibe 403 en las de consulta", async ({ invEmployee }) => {
    for (const path of [
      "/reports/period-summary",
      "/reports/period-summary/deliveries",
      "/reports/assigned-devices",
      "/reports/devices",
    ]) {
      const res = await invEmployee.post(path, periodBody);
      expect(res.status, `${path} exige reports.view`).toBe(403);
    }
  });

  test("un rol sin reports.export recibe 403 en el detalle y en los export", async ({
    invEmployee,
  }) => {
    for (const path of [
      "/reports/period-summary/detail",
      "/reports/assigned-devices/export",
      "/reports/devices/export",
    ]) {
      const res = await invEmployee.post(path, periodBody);
      expect(res.status, `${path} exige reports.export`).toBe(403);
    }
  });

  test("una fecha o una zona inválidas son 400", async ({ inv }) => {
    // `date` y `timezone` inválidas: HttpError del servicio.
    const badDate = await inv.post("/reports/period-summary", {
      period: "MONTH",
      date: "2026-13-45",
      timezone: TZ,
    });
    expect(badDate.status).toBe(400);
    expect(badDate.body.error).toBe("HttpError");

    const impossibleDate = await inv.post("/reports/period-summary", {
      period: "MONTH",
      date: "2030-02-31",
      timezone: TZ,
    });
    expect(impossibleDate.status).toBe(400);

    const badTimezone = await inv.post("/reports/period-summary", {
      period: "MONTH",
      date: PERIOD_MONTH,
      timezone: "Marte/Olympus",
    });
    expect(badTimezone.status).toBe(400);
    expect(badTimezone.body.error).toBe("HttpError");

    // `period` fuera del enum y `date` ausente: los rechaza el DTO.
    for (const body of [{ period: "QUINQUENIO", date: PERIOD_MONTH }, { period: "MONTH" }]) {
      const res = await inv.post("/reports/period-summary", body);
      expect(res.status).toBe(400);
      expect(res.body.error).toBe("ValidationError");
    }
  });

  test("`detailLimit` fuera de 1..2000 es 400", async ({ inv }) => {
    for (const detailLimit of [0, -1, 2001, 5000]) {
      const res = await inv.post("/reports/period-summary/detail", {
        period: "MONTH",
        date: PERIOD_MONTH,
        timezone: TZ,
        detailLimit,
      });
      expect(res.status, `detailLimit ${detailLimit} debe ser 400`).toBe(400);
      expect(res.body.error).toBe("ValidationError");
    }
    // Los bordes válidos entran.
    for (const detailLimit of [1, 2000]) {
      const res = await inv.post("/reports/period-summary/detail", {
        period: "MONTH",
        date: PERIOD_MONTH,
        timezone: TZ,
        detailLimit,
      });
      expect(res.status, `detailLimit ${detailLimit} debe ser 200`).toBe(200);
    }
  });

  test("`limit` fuera de rango en un cuerpo de tabla", async ({ inv }) => {
    // DIVERGENCIA DOCUMENTADA (plan, caso 19): `parseTableParams` es lenitivo y
    // NO devuelve 400; un cuerpo inválido cae al default (page 1, limit 10). Se
    // afirma el comportamiento real para que la prueba sea red si alguien
    // endurece el helper.
    for (const limit of [0, 500, -3]) {
      const res = await inv.post<TableResponse<AssignedDeviceRow>>("/reports/assigned-devices", {
        page: 1,
        limit,
        filters: {},
      });
      expect(res.status).toBe(200);
      expect(res.body.limit).toBe(10);
      expect(res.body.page).toBe(1);
      expect(res.body.pageIndex).toBe(0);
    }
  });

  test("los GET de las nuevas rutas no existen (404) tras el cambio de verbo", async ({ inv }) => {
    for (const path of ["/reports/assigned-devices", "/reports/devices"]) {
      expect((await inv.get(path)).status, `${path} ya no es GET`).toBe(404);
    }
  });
});
