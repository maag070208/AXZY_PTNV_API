import * as XLSX from "xlsx";

/** Lee la primera hoja de un buffer .xlsx/.xls y regresa un arreglo de filas
 * como objetos { <encabezado>: <valor> }, en el orden en que aparecen. */
export const parseFirstSheet = (buffer: Buffer): Record<string, unknown>[] => {
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) return [];
  const sheet = workbook.Sheets[sheetName];
  return XLSX.utils.sheet_to_json(sheet, { defval: "" });
};

export const firstSheetHeaders = (buffer: Buffer): string[] => {
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) return [];
  const values = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[sheetName], {
    header: 1,
    defval: "",
    blankrows: false,
  });
  return (values[0] ?? []).map((value) => String(value ?? ""));
};

const stripAccents = (s: string): string =>
  s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");

/** Normaliza un encabezado de columna para comparar sin importar acentos,
 * mayúsculas/minúsculas o espacios extra ("Descripción " -> "DESCRIPCION"). */
export const normalizeHeader = (s: unknown): string =>
  stripAccents(String(s ?? "")).trim().toUpperCase();

export const hasColumn = (row: Record<string, unknown>, candidate: string): boolean => {
  const expected = normalizeHeader(candidate);
  return Object.keys(row).some((key) => normalizeHeader(key) === expected);
};

/** Busca el valor de una fila probando varios nombres de columna posibles
 * (normalizados), para tolerar variaciones de encabezado entre archivos. */
export const pickColumn = (
  row: Record<string, unknown>,
  candidates: string[]
): string => {
  const normalizedRow: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    normalizedRow[normalizeHeader(k)] = v;
  }
  for (const candidate of candidates) {
    const key = normalizeHeader(candidate);
    const value = normalizedRow[key];
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      return String(value).trim();
    }
  }
  return "";
};
