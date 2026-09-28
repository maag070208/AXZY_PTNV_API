import { test, expect } from "@playwright/test";
import {
  filterBool,
  filterDateRange,
  filterDayRange,
  filterEnum,
  filterId,
  filterText,
  parseTableParams,
} from "../../src/core/utils/table";

/**
 * Contrato de filtros de las tablas server-side: el body se normaliza campo
 * por campo y cada servicio lee sus filtros validados (un valor que la columna
 * no admite es 400 INVALID_FILTER, nunca un 500 ni un filtro ignorado).
 */
test.describe("parseTableParams: filtros", () => {
  test("conserva escalares, incluidos 0 y false, y descarta vacíos", () => {
    const { filters } = parseTableParams({ filters: { a: "x", b: 0, c: false, d: "", e: null, f: { x: 1 } } });
    expect(filters).toEqual({ a: "x", b: 0, c: false });
  });

  test("acepta rangos [desde, hasta] con un extremo abierto", () => {
    const { filters } = parseTableParams({
      filters: { full: ["2026-09-01T06:00:00.000Z", "2026-09-30T05:59:59.999Z"], open: [null, "2026-09-30"], blank: ["", "2026-09-30"] },
    });
    expect(filters.full).toEqual(["2026-09-01T06:00:00.000Z", "2026-09-30T05:59:59.999Z"]);
    expect(filters.open).toEqual([null, "2026-09-30"]);
    expect(filters.blank).toEqual([null, "2026-09-30"]);
  });

  test("descarta arrays que no son rango", () => {
    const { filters } = parseTableParams({ filters: { empty: [null, null], three: ["a", "b", "c"], nums: [1, 2] } });
    expect(filters).toEqual({});
  });
});

const httpError = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return e as { status: number; code: string };
  }
  throw new Error("no lanzó");
};

test.describe("lectura validada de filtros", () => {
  test("filterEnum solo acepta valores del conjunto", () => {
    expect(filterEnum({ status: "OPEN" }, "status", ["OPEN", "CLOSED"])).toBe("OPEN");
    expect(filterEnum({}, "status", ["OPEN"])).toBeUndefined();
    expect(httpError(() => filterEnum({ status: "NOPE" }, "status", ["OPEN"]))).toMatchObject({ status: 400, code: "INVALID_FILTER" });
    expect(httpError(() => filterEnum({ status: 1 }, "status", ["OPEN"]))).toMatchObject({ code: "INVALID_FILTER" });
  });

  test("filterId exige texto", () => {
    expect(filterId({ id: "abc" }, "id")).toBe("abc");
    expect(httpError(() => filterId({ id: ["a", "b"] }, "id"))).toMatchObject({ code: "INVALID_FILTER" });
  });

  test("filterText busca sin distinguir mayúsculas", () => {
    expect(filterText({ title: "Impresora" }, "title")).toEqual({ contains: "Impresora", mode: "insensitive" });
    expect(httpError(() => filterText({ title: true }, "title"))).toMatchObject({ code: "INVALID_FILTER" });
  });

  test("filterDateRange convierte a gte/lte inclusivos", () => {
    const range = filterDateRange({ createdAt: ["2026-09-01T06:00:00.000Z", "2026-09-02T05:59:59.999Z"] }, "createdAt");
    expect(range).toEqual({ gte: new Date("2026-09-01T06:00:00.000Z"), lte: new Date("2026-09-02T05:59:59.999Z") });
    expect(filterDateRange({ createdAt: [null, "2026-09-02T05:59:59.999Z"] }, "createdAt")).toEqual({
      lte: new Date("2026-09-02T05:59:59.999Z"),
    });
  });

  test("filterBool acepta booleanos y sus textos (catálogos y app)", () => {
    expect(filterBool({ a: true }, "a")).toBe(true);
    expect(filterBool({ a: "false" }, "a")).toBe(false);
    expect(filterBool({}, "a")).toBeUndefined();
    expect(httpError(() => filterBool({ a: "si" }, "a"))).toMatchObject({ code: "INVALID_FILTER" });
  });

  test("filterDateRange respeta la zona del ISO local", () => {
    const range = filterDateRange({ d: ["2026-09-19T00:00:00.000-07:00", "2026-09-19T23:59:59.999-07:00"] }, "d");
    expect(range).toEqual({ gte: new Date("2026-09-19T07:00:00.000Z"), lte: new Date("2026-09-20T06:59:59.999Z") });
  });

  test("filterDayRange toma el día del calendario, sin correrlo a UTC", () => {
    const range = filterDayRange({ d: ["2026-09-19T00:00:00.000-07:00", "2026-09-21T23:59:59.999-07:00"] }, "d");
    expect(range).toEqual({ gte: new Date("2026-09-19T00:00:00.000Z"), lte: new Date("2026-09-21T00:00:00.000Z") });
    expect(httpError(() => filterDayRange({ d: ["19/09/2026", null] }, "d"))).toMatchObject({ code: "INVALID_FILTER" });
  });

  test("filterDateRange rechaza fechas inválidas, escalares y rangos invertidos", () => {
    expect(httpError(() => filterDateRange({ d: ["mañana", null] }, "d"))).toMatchObject({ code: "INVALID_FILTER" });
    expect(httpError(() => filterDateRange({ d: "2026-09-01" }, "d"))).toMatchObject({ code: "INVALID_FILTER" });
    expect(httpError(() => filterDateRange({ d: ["2026-09-02", "2026-09-01"] }, "d"))).toMatchObject({ code: "INVALID_RANGE" });
  });
});
