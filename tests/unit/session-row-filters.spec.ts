import { test, expect } from "@playwright/test";
import { filterSessionRows } from "../../src/modules/access/services/session-row-filters";
import type { AccessReportSessionRow } from "../../src/modules/access/models/entity/access.entity";

/** Filtros de columna de los reportes de entradas/salidas (acceso y reloj checador). */
const row = (over: Partial<AccessReportSessionRow>): AccessReportSessionRow => ({
  id: "x",
  employeeId: "u",
  employeeName: "Ana Palma",
  employeeNumber: "562",
  jobTitle: "Guardia",
  departmentId: "d",
  departmentName: "Seguridad",
  active: true,
  date: "2026-09-19",
  entryAt: null,
  exitAt: null,
  workedMinutes: 0,
  incident: null,
  crossesMidnight: false,
  ...over,
});

const rows = [
  row({ id: "1" }),
  row({ id: "2", employeeName: "Luis Pérez", employeeNumber: "100", date: "2026-09-20", incident: "OPEN_ENTRY" }),
  row({ id: "3", departmentName: null, jobTitle: null, date: "2026-09-22", incident: "EXIT_WITHOUT_ENTRY" }),
];
const ids = (filters: Parameters<typeof filterSessionRows>[1]) => filterSessionRows(rows, filters).map((r) => r.id);

test("empleado por nombre o número", () => {
  expect(ids({ employeeName: "luis" })).toEqual(["2"]);
  expect(ids({ employeeName: "562" })).toEqual(["1", "3"]);
});

test("departamento y puesto; los vacíos no coinciden", () => {
  expect(ids({ departmentName: "segu" })).toEqual(["1", "2"]);
  expect(ids({ jobTitle: "guardia" })).toEqual(["1", "2"]);
});

test("rango de días inclusivo, con la zona local del filtro", () => {
  expect(ids({ day: ["2026-09-19T00:00:00.000-07:00", "2026-09-20T23:59:59.999-07:00"] })).toEqual(["1", "2"]);
  expect(ids({ day: ["2026-09-21T00:00:00.000-07:00", null] })).toEqual(["3"]);
});

test("incidencia, incluida la sesión completa", () => {
  expect(ids({ incident: "OPEN_ENTRY" })).toEqual(["2"]);
  expect(ids({ incident: "NONE" })).toEqual(["1"]);
  expect(() => ids({ incident: "OTRA" })).toThrow();
});
