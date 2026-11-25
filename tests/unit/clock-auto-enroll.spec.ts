import { test, expect } from "@playwright/test";
import { shouldAutoEnroll, runAutoEnroll } from "../../src/modules/time-clock/services/clock-auto-enroll";

test("shouldAutoEnroll: solo personal con número de empleado", () => {
  const staff = ["EMPLOYEE", "HR"];
  expect(shouldAutoEnroll({ role: "EMPLOYEE", employeeNumber: "123" }, staff)).toBe(true);
  expect(shouldAutoEnroll({ role: "EMPLOYEE", employeeNumber: " " }, staff)).toBe(false);
  expect(shouldAutoEnroll({ role: "EMPLOYEE", employeeNumber: null }, staff)).toBe(false);
  expect(shouldAutoEnroll({ role: "GUEST", employeeNumber: "123" }, staff)).toBe(false);
});

test("runAutoEnroll: no lanza ante error ni timeout", async () => {
  const failed = await runAutoEnroll(async () => { throw new Error("x"); });
  expect(failed.results[0].ok).toBe(false);
  const slow = await runAutoEnroll(() => new Promise(() => undefined), 20);
  expect(slow.results[0].code).toBe("TIME_CLOCK_TIMEOUT");
  const ok = await runAutoEnroll(async () => ({ results: [] }));
  expect(ok.results).toEqual([]);
});
