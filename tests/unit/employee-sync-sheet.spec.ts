import { test, expect } from "@playwright/test";
import * as XLSX from "xlsx";
import { readEmployeeSyncRows } from "../../src/modules/users/services/employee-sync-sheet";

/**
 * Lectura del Excel de empleados: el formato plantilla (`Empleados`) y el
 * Excel operativo de RH ("S y S" + "Lista de Raya" con renglones de
 * departamento, títulos y columnas de días). Los libros se construyen en
 * memoria con `xlsx`; no hay archivos ni base de datos.
 */

/** Construye un .xlsx en memoria a partir de hojas nombre → matrices. */
const workbookOf = (sheets: Record<string, unknown[][]>): Buffer => {
  const workbook = XLSX.utils.book_new();
  for (const [name, rows] of Object.entries(sheets)) {
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), name);
  }
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
};

/** Código del HttpError con el que truena el lector (o undefined si no truena). */
const errorCodeOf = (fn: () => unknown): string | undefined => {
  try {
    fn();
    return undefined;
  } catch (error) {
    return (error as { code?: string }).code;
  }
};

/** Hoja "S y S" como el archivo real: títulos, encabezado, depto y días. */
const salarySheet = (): unknown[][] => [
  [null, null, null, 12, 13, 14],
  [null, "PRENOMINA SEMANAL CORRESPONDIENTE AL PERIODO No.", null, null, null, 46],
  [null, null, "NOMBRE", 12, 13, 14],
  [null, null, "RECEPCION", "JUEV.", "VIER.", "SAB."],
  [1, 657, "GONZALEZ MARTINEZ RAFAEL ", "X", "X", "X"],
  [2, 88, "CRUZ CORTES LUCAS ", "X", "X", "X"],
  [null, null, "LAVANDERIA"],
  [3, 675, "PEREZ CARDENAS AMELIA", "X", "D", "X"],
];

/** Hoja "Lista de Raya": sin número y con renglones de departamento. */
const payrollSheet = (): unknown[][] => [
  [" ", null, 12, 13],
  [null, "LISTA DE RAYA EX ASIMILADOS NOM SEMANA No. 46", null, null],
  [null, "NOMBRE", 12, 13],
  [null, "AMA DE LLAVES", "JUEV.", "VIE"],
  [1, "BARAJAS GONZALEZ SANDRA", "X", "X"],
  [2, "DELGADO CARRILLO EUNICE", "X", "X"],
  [null, null, 12],
  [null, "LAVANDERIA", "JUEV.", "VIE"],
  [19, "RAMIREZ CASTAÑEDA MARIA ANTONIETA", "X", "D"],
];

test.describe("Excel operativo de RH", () => {
  test("lee las dos hojas en orden, hereda departamento y tipo de nómina", () => {
    const buffer = workbookOf({
      "S y S": salarySheet(),
      "Lista de Raya": payrollSheet(),
    });
    const read = readEmployeeSyncRows(buffer);

    expect(read.sheet).toBe("S y S + Lista de Raya");
    expect(read.rows).toHaveLength(6);
    expect(read.rows).toEqual([
      {
        sheet: "S y S",
        row: 5,
        employeeNumber: "657",
        name: "GONZALEZ MARTINEZ RAFAEL",
        departmentName: "RECEPCION",
        jobTitle: "",
        payrollType: "S y S",
        scheduleName: "",
      },
      {
        sheet: "S y S",
        row: 6,
        employeeNumber: "88",
        name: "CRUZ CORTES LUCAS",
        departmentName: "RECEPCION",
        jobTitle: "",
        payrollType: "S y S",
        scheduleName: "",
      },
      {
        sheet: "S y S",
        row: 8,
        employeeNumber: "675",
        name: "PEREZ CARDENAS AMELIA",
        departmentName: "LAVANDERIA",
        jobTitle: "",
        payrollType: "S y S",
        scheduleName: "",
      },
      {
        sheet: "Lista de Raya",
        row: 5,
        employeeNumber: "",
        name: "BARAJAS GONZALEZ SANDRA",
        departmentName: "AMA DE LLAVES",
        jobTitle: "",
        payrollType: "Lista de Raya",
        scheduleName: "",
      },
      {
        sheet: "Lista de Raya",
        row: 6,
        employeeNumber: "",
        name: "DELGADO CARRILLO EUNICE",
        departmentName: "AMA DE LLAVES",
        jobTitle: "",
        payrollType: "Lista de Raya",
        scheduleName: "",
      },
      {
        sheet: "Lista de Raya",
        row: 9,
        employeeNumber: "",
        name: "RAMIREZ CASTAÑEDA MARIA ANTONIETA",
        departmentName: "LAVANDERIA",
        jobTitle: "",
        payrollType: "Lista de Raya",
        scheduleName: "",
      },
    ]);
  });

  test("aplica el departamento a las filas siguientes hasta el próximo renglón", () => {
    const buffer = workbookOf({
      "S y S": salarySheet(),
      "Lista de Raya": payrollSheet(),
    });
    const read = readEmployeeSyncRows(buffer);
    expect(read.rows[2]).toMatchObject({
      name: "PEREZ CARDENAS AMELIA",
      departmentName: "LAVANDERIA",
    });
  });

  test("ignora filas vacías, encabezados de días y renglones sin nombre", () => {
    const buffer = workbookOf({
      "S y S": [
        ...salarySheet(),
        [null, null, null, null],
        [null, null, "SAB.", "X"],
        [null, null, null, null],
      ],
      "Lista de Raya": payrollSheet(),
    });
    const read = readEmployeeSyncRows(buffer);
    expect(read.rows).toHaveLength(6);
  });

  test("una hoja operativa trazada como libro sin filas da USER_SYNC_EMPTY", () => {
    const buffer = workbookOf({
      "S y S": [
        [null, null, null],
        [null, null, "NOMBRE"],
        [null, null, "RECEPCION"],
      ],
    });
    expect(errorCodeOf(() => readEmployeeSyncRows(buffer))).toBe("USER_SYNC_EMPTY");
  });

  test("un libro sin hojas reconocibles da USER_SYNC_SHEET_NOT_FOUND", () => {
    const buffer = workbookOf({ Otra: [["A", "B"]] });
    expect(errorCodeOf(() => readEmployeeSyncRows(buffer))).toBe(
      "USER_SYNC_SHEET_NOT_FOUND"
    );
  });
});

test.describe("Hoja plana genérica", () => {
  test("acepta cualquier hoja con encabezado NUM_EMPLEADO", () => {
    const buffer = workbookOf({
      "Lista Empleados 2026": [
        ["NUM_EMPLEADO", "NOMBRE_COMPLETO", "DEPARTAMENTO", "PUESTO", "TIPO_NOMINA", "HORARIO"],
        ["0657", "GONZALEZ MARTINEZ RAFAEL", "RECEPCION", "", "S y S", ""],
      ],
    });
    const read = readEmployeeSyncRows(buffer);
    expect(read.sheet).toBe("Lista Empleados 2026");
    expect(read.rows).toHaveLength(1);
    expect(read.rows[0]).toMatchObject({
      row: 2,
      employeeNumber: "0657",
      name: "GONZALEZ MARTINEZ RAFAEL",
      departmentName: "RECEPCION",
    });
  });

  test("las hojas operativas ganan sobre una hoja plana genérica", () => {
    const buffer = workbookOf({
      "Lista de Raya": payrollSheet(),
      "Lista Empleados 2026": [
        ["NUM_EMPLEADO", "NOMBRE_COMPLETO", "DEPARTAMENTO"],
        ["657", "GONZALEZ MARTINEZ RAFAEL", "RECEPCION"],
      ],
    });
    const read = readEmployeeSyncRows(buffer);
    expect(read.sheet).toBe("Lista de Raya");
    expect(read.rows).toHaveLength(3);
    expect(read.rows.every((row) => row.payrollType === "Lista de Raya")).toBe(true);
  });

  test("la hoja Empleados gana sobre la plana genérica", () => {
    const buffer = workbookOf({
      Empleados: [
        ["NUM_EMPLEADO", "NOMBRE_COMPLETO", "DEPARTAMENTO"],
        ["657", "GONZALEZ MARTINEZ RAFAEL", "RECEPCION"],
      ],
      "Lista Empleados 2026": [
        ["NUM_EMPLEADO", "NOMBRE_COMPLETO", "DEPARTAMENTO"],
        ["722", "LOPEZ SALAS ANA JESSICA", "RECEPCION"],
      ],
    });
    const read = readEmployeeSyncRows(buffer);
    expect(read.sheet).toBe("Empleados");
    expect(read.rows).toHaveLength(1);
    expect(read.rows[0].employeeNumber).toBe("657");
  });
});

test.describe("Excel plantilla", () => {
  test("sigue leyendo la hoja Empleados con sus encabezados", () => {
    const buffer = workbookOf({
      Empleados: [
        ["NUM_EMPLEADO", "NOMBRE_COMPLETO", "DEPARTAMENTO", "PUESTO", "TIPO_NOMINA", "HORARIO"],
        ["0657", "GONZALEZ MARTINEZ RAFAEL", "RECEPCION", "AYUDANTE", "S y S", "MATUTINO"],
        ["", "BARAJAS GONZALEZ SANDRA", "AMA DE LLAVES", "", "Lista de Raya", ""],
      ],
    });
    const read = readEmployeeSyncRows(buffer);
    expect(read.sheet).toBe("Empleados");
    expect(read.rows).toHaveLength(2);
    expect(read.rows[0]).toMatchObject({
      row: 2,
      employeeNumber: "0657",
      name: "GONZALEZ MARTINEZ RAFAEL",
      departmentName: "RECEPCION",
      jobTitle: "AYUDANTE",
      payrollType: "S y S",
      scheduleName: "MATUTINO",
    });
    expect(read.rows[1]).toMatchObject({
      row: 3,
      employeeNumber: "",
      name: "BARAJAS GONZALEZ SANDRA",
      payrollType: "Lista de Raya",
    });
  });

  test("si hay plantilla y hojas operativas, gana la plantilla", () => {
    const buffer = workbookOf({
      Empleados: [
        ["NUM_EMPLEADO", "NOMBRE_COMPLETO", "DEPARTAMENTO"],
        ["657", "GONZALEZ MARTINEZ RAFAEL", "RECEPCION"],
      ],
      "S y S": salarySheet(),
    });
    const read = readEmployeeSyncRows(buffer);
    expect(read.sheet).toBe("Empleados");
    expect(read.rows).toHaveLength(1);
  });
});
