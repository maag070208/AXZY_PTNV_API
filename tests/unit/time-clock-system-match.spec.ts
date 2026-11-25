import { test, expect } from "@playwright/test";
import {
  buildSystemUserIndex,
  classifySystemStatus,
} from "../../src/modules/time-clock/services/time-clock-system-match";

/** Clasificación pura de personas del reloj frente al sistema (sin base de datos). */
const users = [
  { id: "u1", name: "Ana", employeeNumber: "070562" },
  { id: "u2", name: "Beto", employeeNumber: "562" },
  { id: "u3", name: "Carla", employeeNumber: "000777" },
  { id: "u4", name: "Dani", employeeNumber: "110778" },
  { id: "u5", name: "Eli", employeeNumber: "040778" },
  { id: "u6", name: "Sin número", employeeNumber: null },
];
const index = buildSystemUserIndex(users);

test("LINKED cuando hay vínculo activo", () => {
  expect(classifySystemStatus("070562", { userId: "x", userName: "X" }, index)).toEqual({
    status: "LINKED",
    userId: "x",
    userName: "X",
  });
});

test("MATCH por número literal aunque haya otro con la misma nómina", () => {
  expect(classifySystemStatus("070562", null, index)).toEqual({ status: "MATCH", userId: "u1", userName: "Ana" });
});

test("MATCH sin prefijo de área (un solo candidato)", () => {
  expect(classifySystemStatus("050777", null, index)).toEqual({ status: "MATCH", userId: "u3", userName: "Carla" });
});

test("varios candidatos por nómina => NONE", () => {
  expect(classifySystemStatus("090778", null, index).status).toBe("NONE");
});

test("sin candidatos o número no numérico => NONE", () => {
  expect(classifySystemStatus("999999", null, index).status).toBe("NONE");
  expect(classifySystemStatus("ABC", null, index).status).toBe("NONE");
});
