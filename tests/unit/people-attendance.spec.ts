import { test, expect } from "@playwright/test";
import type { PrismaClient } from "@prisma/client";
import { HttpError } from "../../src/core/middlewares/error.middleware";
import { resolveReportRange } from "../../src/core/utils/timezone";
import type { ITDataTableFetchParams } from "../../src/core/utils/table";
import type {
  AccessReportPerson,
  AccessReportSessionRow,
} from "../../src/modules/access/models/entity/access.entity";
import { PeopleAttendanceService } from "../../src/modules/schedules/services/people-attendance.service";

/**
 * Entradas y salidas por persona: cada día del periodo contra el horario
 * (asistió, retardo, falta, descanso, pendiente), horas, en sitio y los
 * totales de la pantalla. Sin BD: fuente y Prisma son dobles.
 */

const TZ = "UTC";
// Semana miércoles 16 → martes 22 de septiembre de 2026; "ahora" = lunes 21, 10:00.
const NOW = Date.parse("2026-09-21T10:00:00.000Z");
const at = (day: string, hhmm: string) => `2026-09-${day}T${hhmm}:00.000Z`;

const person = (id: string, name: string, over: Partial<AccessReportPerson> = {}): AccessReportPerson => ({
  id,
  name,
  employeeNumber: id,
  jobTitle: null,
  department: { id: "d1", name: "Recepción" },
  active: true,
  linked: true,
  ...over,
});

const session = (
  employeeId: string,
  day: string,
  entry: string | null,
  exit: string | null,
  incident: AccessReportSessionRow["incident"] = null
): AccessReportSessionRow => {
  const entryAt = entry ? at(day, entry) : null;
  const exitAt = exit ? at(day, exit) : null;
  return {
    id: `${employeeId}-${day}`,
    employeeId,
    employeeName: employeeId,
    employeeNumber: null,
    jobTitle: null,
    departmentId: "d1",
    departmentName: "Recepción",
    active: true,
    date: `2026-09-${day}`,
    entryAt,
    exitAt,
    workedMinutes: entryAt && exitAt ? (Date.parse(exitAt) - Date.parse(entryAt)) / 60_000 : 0,
    incident,
    crossesMidnight: false,
  };
};

// Lunes a viernes 09:00–17:00 con 10 min de tolerancia; sábado y domingo descanso.
const officeHours = {
  name: "Oficina",
  entryToleranceMin: 10,
  exitToleranceMin: 0,
  mealBreakMin: 0,
  minOvertimeMin: 60,
  crossesMidnight: false,
  days: [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({
    weekday,
    startTime: weekday <= 5 ? "09:00" : null,
    endTime: weekday <= 5 ? "17:00" : null,
    splitStartTime: null,
    splitEndTime: null,
    restDay: weekday > 5,
  })),
};

const people = [
  person("ana", "Ana Palma"),
  person("luis", "Luis Pérez"),
  person("maria", "María Gómez"),
  person("reloj:777", "Reloj 777", { linked: false, department: null }),
];
const sessions = [
  session("ana", "16", "09:05", "17:00"), // a tiempo (dentro de la tolerancia)
  session("ana", "17", "09:30", "17:00"), // retardo de 30
  session("ana", "21", "09:20", null, "OPEN_ENTRY"), // hoy: retardo y sigue en sitio
  session("maria", "17", "08:00", null, "ENTRY_WITHOUT_EXIT"),
  session("reloj:777", "16", "08:00", "12:00"),
];

const askedUserIds: string[][] = [];
const db = {
  scheduleAssignment: {
    findMany: async ({ where }: { where: { userId: { in: string[] } } }) => {
      askedUserIds.push(where.userId.in);
      return ["ana", "luis"]
        .filter((id) => where.userId.in.includes(id))
        .map((userId) => ({ userId, validFrom: new Date("2026-01-01T00:00:00.000Z"), validTo: null, schedule: officeHours }));
    },
  },
} as unknown as PrismaClient;

const source = {
  sessions: async () => ({
    people,
    rows: sessions,
    range: {
      start: new Date("2026-09-16T00:00:00.000Z"),
      end: new Date("2026-09-23T00:00:00.000Z"),
      timezone: TZ,
      period: "WEEK" as const,
    },
  }),
};
const service = new PeopleAttendanceService({ TIME_CLOCK: source, ACCESS: source }, db, () => NOW);

const query = (filters: ITDataTableFetchParams["filters"] = {}, over: Partial<ITDataTableFetchParams> = {}) =>
  service.report("TIME_CLOCK", { page: 1, limit: 25, filters: { period: "WEEK", date: "2026-09-21", ...filters }, ...over });

test.describe("PeopleAttendanceService", () => {
  test("cada día se califica contra el horario", async () => {
    const { data } = await query();
    const statusOf = (id: string) => data.find((r) => r.employeeId === id)!.days.map((d) => d.status);

    expect(statusOf("ana")).toEqual(["ATTENDED", "LATE", "ABSENCE", "REST", "REST", "LATE", "PENDING"]);
    // Sin registros: falta los días laborales ya pasados y hoy, porque ya pasó su entrada + tolerancia.
    expect(statusOf("luis")).toEqual(["ABSENCE", "ABSENCE", "ABSENCE", "REST", "REST", "ABSENCE", "PENDING"]);
    // Sin horario (y el número del reloj sin usuario): asiste si registró; si no, no se sabe.
    expect(statusOf("maria")).toEqual(["NO_INFO", "ATTENDED", "NO_INFO", "NO_INFO", "NO_INFO", "NO_INFO", "PENDING"]);
    expect(statusOf("reloj:777")[0]).toBe("ATTENDED");
    // El número del reloj sin usuario no se busca en los horarios.
    expect(askedUserIds.at(-1)).toEqual(["ana", "luis", "maria"]);
  });

  test("hoy antes de la entrada + tolerancia todavía no es falta", async () => {
    const early = new PeopleAttendanceService({ TIME_CLOCK: source, ACCESS: source }, db, () =>
      Date.parse("2026-09-21T09:05:00.000Z")
    );
    const { data } = await early.report("TIME_CLOCK", { page: 1, limit: 25, filters: {} });
    expect(data.find((r) => r.employeeId === "luis")!.days[5].status).toBe("PENDING");
  });

  test("retardo, en sitio, horas en curso y salida pendiente del día", async () => {
    const { data } = await query();
    const ana = data.find((r) => r.employeeId === "ana")!;
    expect(ana.days[1]).toMatchObject({ lateMinutes: 30, workedMinutes: 450 });
    // Hoy: entró 09:20 y sigue dentro → 40 min transcurridos, sin salida que mostrar.
    expect(ana.days[5]).toMatchObject({ entryAt: at("21", "09:20"), exitAt: null, onSite: true, lateMinutes: 20, workedMinutes: 40 });
    expect(ana).toMatchObject({ workedMinutes: 475 + 450 + 40, onSite: true, hasRecords: true, lateDays: 2, absences: 1 });

    const maria = data.find((r) => r.employeeId === "maria")!;
    expect(maria.days[1].incident).toBe("ENTRY_WITHOUT_EXIT");
    expect(maria).toMatchObject({ withoutExit: 1, lateDays: 0, absences: 0, onSite: false });
    expect(data.find((r) => r.employeeId === "reloj:777")!.linked).toBe(false);
  });

  test("resumen de todas las personas, con los días del periodo y hoy", async () => {
    const { summary } = await query({ view: "ON_SITE" });
    expect(summary).toMatchObject({
      people: 4,
      withRecords: 3,
      withoutRecords: 1,
      onSite: 1,
      lateDays: 2,
      absences: 5,
      withoutExit: 1,
      withoutEntry: 0,
      workedMinutes: 475 + 450 + 40 + 240,
    });
    expect(summary.range.days).toEqual(["16", "17", "18", "19", "20", "21", "22"].map((d) => `2026-09-${d}`));
    expect(summary.range.today).toBe("2026-09-21");
  });

  test("vistas rápidas, orden y paginación", async () => {
    const ids = async (...args: Parameters<typeof query>) => (await query(...args)).data.map((r) => r.employeeId);
    expect(await ids({ view: "INCIDENTS" })).toEqual(["ana", "luis", "maria"]);
    expect(await ids({ view: "ON_SITE" })).toEqual(["ana"]);
    expect(await ids({ view: "WITHOUT_RECORDS" })).toEqual(["luis"]);
    expect(await ids({}, { sort: { key: "workedMinutes", direction: "desc" } })).toEqual(["ana", "reloj:777", "luis", "maria"]);

    const page2 = await query({}, { page: 2, limit: 2 });
    expect(page2.data.map((r) => r.employeeId)).toEqual(["maria", "reloj:777"]);
    expect(page2.total).toBe(4);
  });

  test("una vista que no existe es 400", async () => {
    await expect(query({ view: "EVERYONE" })).rejects.toMatchObject({ status: 400, code: "INVALID_FILTER" } as Partial<HttpError>);
  });
});

test.describe("quincena", () => {
  test("1–15 y 16–fin de mes", () => {
    const iso = (r: { start: Date; end: Date }) => [r.start.toISOString(), r.end.toISOString()];
    expect(iso(resolveReportRange("FORTNIGHT", "2026-09-21", TZ))).toEqual(["2026-09-16T00:00:00.000Z", "2026-10-01T00:00:00.000Z"]);
    expect(iso(resolveReportRange("FORTNIGHT", "2026-02-15", TZ))).toEqual(["2026-02-01T00:00:00.000Z", "2026-02-16T00:00:00.000Z"]);
    expect(iso(resolveReportRange("FORTNIGHT", "2026-12-31", TZ))).toEqual(["2026-12-16T00:00:00.000Z", "2027-01-01T00:00:00.000Z"]);
  });
});
