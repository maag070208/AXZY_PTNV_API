import { test, expect } from "@playwright/test";
import { normalizeEmployeeNumber, isDuplicateInFile } from "../../src/modules/users/services/user-import.service";

test("normalizeEmployeeNumber: recorta y vacío = null", () => {
  expect(normalizeEmployeeNumber(" 123 ")).toBe("123");
  expect(normalizeEmployeeNumber("   ")).toBeNull();
  expect(normalizeEmployeeNumber(undefined)).toBeNull();
});

test("isDuplicateInFile: detecta repetidos dentro del archivo", () => {
  const seen = new Set<string>();
  expect(isDuplicateInFile(seen, "10")).toBe(false);
  expect(isDuplicateInFile(seen, "11")).toBe(false);
  expect(isDuplicateInFile(seen, "10")).toBe(true);
});
