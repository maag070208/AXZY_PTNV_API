import { test, expect } from "@playwright/test";
import {
  buildTimeline,
  resolveDuplicateMs,
  withoutDuplicates,
} from "../../src/modules/time-clock/services/time-clock-timeline";

const MIN = 60_000;
const BASE = Date.parse("2026-01-12T08:00:00Z");
const at = (min: number) => new Date(BASE + min * MIN);
const DUP = 2 * MIN;
const LATER = BASE + 48 * 60 * MIN; // mucho después del tope de 13 h

test.describe("buildTimeline", () => {
  test("solo entrada: OPEN_ENTRY dentro del tope, sin salida después", () => {
    const [open] = buildTimeline([at(0)], DUP, BASE + 60 * MIN);
    expect(open.exitAt).toBeNull();
    expect(open.incident).toBe("OPEN_ENTRY");
    expect(open.onSite).toBe(true);
    const [stale] = buildTimeline([at(0)], DUP, LATER);
    expect(stale.incident).toBe("ENTRY_WITHOUT_EXIT");
    expect(stale.onSite).toBe(false);
  });

  test("entrada + salida: sin salidas intermedias y fuera de sitio", () => {
    const [j] = buildTimeline([at(0), at(480)], DUP, BASE + 600 * MIN);
    expect(j.exitAt).toEqual(at(480));
    expect(j.outings).toEqual([]);
    expect(j.awayMinutes).toBe(0);
    expect(j.incompleteSequence).toBe(false);
    expect(j.onSite).toBe(false);
    expect(j.incident).toBeNull();
  });

  test("entrada, salida, regreso, salida: una salida con tiempo fuera", () => {
    const [j] = buildTimeline([at(0), at(180), at(215), at(480)], DUP, BASE + 600 * MIN);
    expect(j.outings).toEqual([{ exitAt: at(180), returnAt: at(215) }]);
    expect(j.awayMinutes).toBe(35);
    expect(j.incompleteSequence).toBe(false);
    expect(j.punches).toHaveLength(4);
  });

  test("intermedias impares: secuencia incompleta", () => {
    const [j] = buildTimeline([at(0), at(180), at(480)], DUP, LATER);
    expect(j.outings).toEqual([{ exitAt: at(180), returnAt: null }]);
    expect(j.awayMinutes).toBe(0);
    expect(j.incompleteSequence).toBe(true);
  });

  test("jornada abierta con impares: ya regresó, no es incompleta", () => {
    const [j] = buildTimeline([at(0), at(180), at(240)], DUP, BASE + 300 * MIN);
    expect(j.incompleteSequence).toBe(false);
    expect(j.onSite).toBe(true);
  });

  test("checadas repetidas dentro de la ventana se colapsan", () => {
    const list = withoutDuplicates([at(0), at(1), at(5), at(6)], DUP);
    expect(list).toEqual([at(0), at(5)]);
  });

  test("la ventana es configurable (2 vs 5 min)", () => {
    const input = [at(0), at(3), at(480)];
    expect(buildTimeline(input, 2 * MIN, LATER)[0].punches).toHaveLength(3);
    expect(buildTimeline(input, 5 * MIN, LATER)[0].punches).toHaveLength(2);
    expect(resolveDuplicateMs(undefined)).toBe(2 * MIN);
    expect(resolveDuplicateMs("5")).toBe(5 * MIN);
    expect(resolveDuplicateMs("99")).toBe(30 * MIN);
    expect(resolveDuplicateMs("-3")).toBe(0);
    expect(resolveDuplicateMs("abc")).toBe(2 * MIN);
  });

  test("en sitio tras un regreso, fuera tras una salida (dentro del tope)", () => {
    const now = BASE + 400 * MIN;
    const [back] = buildTimeline([at(0), at(180), at(215), at(240), at(300)], DUP, now);
    // 5 checadas (impar): la última fue regreso/entrada.
    expect(back.onSite).toBe(true);
    const [out] = buildTimeline([at(0), at(180), at(215), at(300)], DUP, now);
    expect(out.onSite).toBe(false);
  });

  test("una nueva jornada abre después del tope de 13 h", () => {
    const list = buildTimeline([at(0), at(480), at(24 * 60)], DUP, LATER);
    expect(list).toHaveLength(2);
  });
});
