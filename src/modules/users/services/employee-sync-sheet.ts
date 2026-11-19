import { HttpError } from "@core/middlewares/error.middleware";
import { normalizeHeader, parseSheet, pickColumn, sheetHeaders, sheetNames, sheetRows } from "@core/utils/xlsxParse";
import {
  PAYROLL_TYPE_PAYROLL,
  PAYROLL_TYPE_SALARY,
  normalizeName,
  type SyncSheetRow,
} from "./employee-sync-rules";

/**
 * Lectura del Excel de empleados. Dos formatos conviven:
 *
 * 1. **Plantilla** (`Empleados`): una hoja con encabezados y una fila por
 *    persona (NUM_EMPLEADO, NOMBRE_COMPLETO, DEPARTAMENTO, PUESTO, TIPO_NOMINA,
 *    HORARIO). Es el formato que se pide cargar; se sigue soportando tal cual.
 * 2. **Excel operativo de RH** (el que llega cada semana): dos hojas
 *    ("S y S" y "Lista de Raya") con títulos, leyendas y renglones de
 *    departamento intercalados. No se le pide a RH que lo cambie: aquí se lee
 *    y se extrae lo necesario (departamento heredado, número, nombre y tipo de
 *    nómina).
 *
 * En ambos casos el resultado son las filas de PERSONA en el orden en que
 * aparecen (primero "S y S" y luego "Lista de Raya"), que es justamente el
 * orden de nómina que usan las pantallas de pre-nómina.
 */

/** Hoja del formato de plantilla. */
export const EMPLOYEE_SYNC_SHEET = "Empleados";

/** Encabezados tolerados por columna de la plantilla. */
const EMPLOYEE_NUMBER_HEADERS = [
  "NUM_EMPLEADO",
  "NUM EMPLEADO",
  "NÚMERO DE EMPLEADO",
  "NUMERO DE EMPLEADO",
  "NO. EMPLEADO",
  "NO EMPLEADO",
];
const NAME_HEADERS = ["NOMBRE_COMPLETO", "NOMBRE COMPLETO", "NOMBRE"];
const DEPARTMENT_HEADERS = ["DEPARTAMENTO", "DEPTO"];
const JOB_TITLE_HEADERS = ["PUESTO", "JOB TITLE", "JOB_TITLE"];
const PAYROLL_TYPE_HEADERS = [
  "TIPO_NOMINA",
  "TIPO NOMINA",
  "TIPO NÓMINA",
  "NOMINA",
  "NÓMINA",
];
const SCHEDULE_HEADERS = ["HORARIO", "SCHEDULE"];

/** Etiquetas de los encabezados de días que trae el Excel operativo. */
const DAY_LABELS = new Set([
  "LUN",
  "LUNES",
  "MAR",
  "MARTES",
  "MIE",
  "MIERCOLES",
  "JUE",
  "JUEV",
  "JUEVES",
  "VIE",
  "VIERNES",
  "SAB",
  "SABADO",
  "DOM",
  "DOMINGO",
]);

interface OperationalSheet {
  /** Nombre real de la hoja en el libro. */
  name: string;
  /** Etiqueta que se usa en la respuesta (`sheet`). */
  label: string;
  payrollType: string;
}

/** Hojas del Excel operativo, en el orden en que se numeran las personas. */
const OPERATIONAL_SHEETS: OperationalSheet[] = [
  { name: "", label: "S y S", payrollType: PAYROLL_TYPE_SALARY },
  { name: "", label: "Lista de Raya", payrollType: PAYROLL_TYPE_PAYROLL },
];

export interface EmployeeSyncSheetRead {
  /** Hoja(s) de las que salieron las filas ("Empleados" o "S y S + Lista de Raya"). */
  sheet: string;
  rows: SyncSheetRow[];
}

const isBlank = (value: string): boolean => value.trim() === "";

/** Texto de una celda: recortado y con espacios colapsados (los nombres del Excel operativo traen relleno). */
const cellText = (value: unknown): string =>
  value === null || value === undefined ? "" : normalizeName(value);

/* -------------------------------------------------------------------------- */
/* Formato plantilla (`Empleados`)                                            */
/* -------------------------------------------------------------------------- */

const hasEmployeeNumberColumn = (buffer: Buffer, sheet: string): boolean =>
  sheetHeaders(buffer, sheet).some((header) =>
    EMPLOYEE_NUMBER_HEADERS.some(
      (candidate) => normalizeHeader(candidate) === normalizeHeader(header)
    )
  );

/** Hoja de plantilla: la llamada `Empleados`, solo si tiene la columna NUM_EMPLEADO. */
const findTemplateSheet = (buffer: Buffer, names: string[]): string | null => {
  const preferred = names.find(
    (name) => normalizeHeader(name) === normalizeHeader(EMPLOYEE_SYNC_SHEET)
  );
  return preferred && hasEmployeeNumberColumn(buffer, preferred) ? preferred : null;
};

/**
 * Hoja plana genérica: cualquier otra hoja con encabezado NUM_EMPLEADO. Es la
 * tercera opción (el Excel nuevo de RH puede traer la lista de empleados en su
 * propia hoja, con los encabezados del contrato), después de la plantilla y de
 * las hojas operativas. Se excluyen las hojas ya conocidas para no repetirlas.
 */
const findFlatSheet = (
  buffer: Buffer,
  names: string[],
  operationalNames: Set<string>
): string | null =>
  names.find(
    (name) =>
      !operationalNames.has(name) &&
      normalizeHeader(name) !== normalizeHeader(EMPLOYEE_SYNC_SHEET) &&
      hasEmployeeNumberColumn(buffer, name)
  ) ?? null;

/** Filas de persona del formato plantilla (una fila por empleado). */
const parseTemplateRows = (buffer: Buffer, sheet: string): SyncSheetRow[] => {
  const rows: SyncSheetRow[] = [];
  parseSheet(buffer, sheet).forEach((item, index) => {
    const row: SyncSheetRow = {
      sheet,
      row: index + 2, // +1 por el encabezado, +1 porque Excel empieza en 1
      employeeNumber: pickColumn(item, EMPLOYEE_NUMBER_HEADERS),
      name: pickColumn(item, NAME_HEADERS),
      departmentName: pickColumn(item, DEPARTMENT_HEADERS),
      jobTitle: pickColumn(item, JOB_TITLE_HEADERS),
      payrollType: pickColumn(item, PAYROLL_TYPE_HEADERS),
      scheduleName: pickColumn(item, SCHEDULE_HEADERS),
    };
    const empty = [
      row.employeeNumber,
      row.name,
      row.departmentName,
      row.jobTitle,
      row.payrollType,
      row.scheduleName,
    ].every((value) => value === "");
    if (!empty) rows.push(row);
  });
  return rows;
};

/* -------------------------------------------------------------------------- */
/* Formato operativo de RH (`S y S` + `Lista de Raya`)                        */
/* -------------------------------------------------------------------------- */

/** Hojas operativas presentes en el libro, en el orden de numeración (S y S primero). */
const findOperationalSheets = (names: string[]): OperationalSheet[] =>
  OPERATIONAL_SHEETS.flatMap((definition) => {
    const name = names.find(
      (candidate) => normalizeHeader(candidate) === normalizeHeader(definition.label)
    );
    return name ? [{ ...definition, name }] : [];
  });

/**
 * Localiza la fila de encabezado y la columna del nombre. El Excel operativo
 * trae títulos y leyendas arriba; el primer renglón con la celda "NOMBRE" es el
 * encabezado real (en "S y S" cae en la columna C y en "Lista de Raya" en B).
 */
const findHeader = (
  rows: unknown[][]
): { headerRow: number; nameCol: number } | null => {
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
    const cells = rows[rowIndex] ?? [];
    for (let col = 0; col < cells.length; col++) {
      if (normalizeHeader(cells[col]) === "NOMBRE") {
        return { headerRow: rowIndex, nameCol: col };
      }
    }
  }
  return null;
};

const nameKeyOf = (value: string): string =>
  normalizeHeader(value).replace(/[^A-Z]/g, "");

/**
 * Filas de persona de una hoja operativa. Los renglones de departamento (sin
 * consecutivo y sin número, con el nombre del área en la columna del nombre)
 * fijan el departamento de las filas siguientes. Se ignoran filas vacías,
 * encabezados repetidos de "NOMBRE" y los encabezados de días.
 */
const parseOperationalRows = (
  buffer: Buffer,
  sheet: OperationalSheet
): SyncSheetRow[] => {
  const matrix = sheetRows(buffer, sheet.name);
  const header = findHeader(matrix);
  if (!header) return [];

  const { headerRow, nameCol } = header;
  // "S y S": A = consecutivo, B = número, C = nombre. "Lista de Raya": A =
  // consecutivo, B = nombre (sin número de empleado).
  const numberCol =
    sheet.payrollType === PAYROLL_TYPE_SALARY && nameCol > 0 ? nameCol - 1 : null;

  const rows: SyncSheetRow[] = [];
  let department = "";
  for (let rowIndex = headerRow + 1; rowIndex < matrix.length; rowIndex++) {
    const cells = matrix[rowIndex] ?? [];
    const employeeNumber = numberCol === null ? "" : cellText(cells[numberCol]);
    const sequence = cellText(cells[0]);
    const name = cellText(cells[nameCol]);
    if (isBlank(sequence) && isBlank(name) && isBlank(employeeNumber)) {
      // Fila vacía o de encabezado de días (solo trae números de día).
      continue;
    }
    const nameKey = nameKeyOf(name);
    if (nameKey === "NOMBRE" || DAY_LABELS.has(nameKey)) continue;
    // Renglón de departamento: sin consecutivo ni número, con el nombre del área.
    if (isBlank(sequence) && isBlank(employeeNumber)) {
      if (!isBlank(name)) department = name;
      continue;
    }
    if (isBlank(name)) continue;
    rows.push({
      sheet: sheet.name,
      row: rowIndex + 1, // el índice de la matriz es 0-based; Excel empieza en 1
      employeeNumber,
      name,
      departmentName: department,
      jobTitle: "",
      payrollType: sheet.payrollType,
      scheduleName: "",
    });
  }
  return rows;
};

/* -------------------------------------------------------------------------- */
/* API del lector                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Lee el Excel de empleados sin escribir nada: primero intenta el formato
 * plantilla (`Empleados`) y, si no está, el operativo de RH ("S y S" y
 * "Lista de Raya"). Devuelve las filas de persona en orden de nómina.
 */
export const readEmployeeSyncRows = (buffer: Buffer): EmployeeSyncSheetRead => {
  const names = sheetNames(buffer);

  const template = findTemplateSheet(buffer, names);
  if (template) {
    const rows = parseTemplateRows(buffer, template);
    if (rows.length === 0) throw new HttpError(400, "USER_SYNC_EMPTY");
    return { sheet: template, rows };
  }

  const operational = findOperationalSheets(names);
  if (operational.length > 0) {
    const rows = operational.flatMap((sheet) => parseOperationalRows(buffer, sheet));
    if (rows.length === 0) throw new HttpError(400, "USER_SYNC_EMPTY");
    return { sheet: operational.map((sheet) => sheet.label).join(" + "), rows };
  }

  // Tercera opción: una hoja plana cualquiera con los encabezados del contrato.
  const flat = findFlatSheet(
    buffer,
    names,
    new Set(operational.map((sheet) => sheet.name))
  );
  if (flat) {
    const rows = parseTemplateRows(buffer, flat);
    if (rows.length === 0) throw new HttpError(400, "USER_SYNC_EMPTY");
    return { sheet: flat, rows };
  }

  throw new HttpError(400, "USER_SYNC_SHEET_NOT_FOUND");
};
