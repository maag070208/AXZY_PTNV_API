import { test, expect } from "@playwright/test";
import {
  classifyEmployeeSync,
  nameLooksAlike,
  normalizeKey,
  normalizeName,
  parseEmployeeNumber,
  parsePayrollType,
  proposedPassword,
  proposeUsername,
  provisionalPassword,
  samePayrollNumber,
  samePersonName,
  systemPayrollNumber,
  usernameBase,
  type SyncDepartmentRef,
  type SyncScheduleRef,
  type SyncSheetRow,
  type SyncUserRef,
} from "../../src/modules/users/services/employee-sync-rules";

/**
 * Reglas puras de la sincronización de empleados desde el Excel de nómina.
 * No tocan base de datos: la clasificación entra por parámetros.
 */

/* ------------------------------------------------------------------ */
/* Datos de apoyo                                                      */
/* ------------------------------------------------------------------ */

const DEPARTMENTS: SyncDepartmentRef[] = [
  { id: "d-recepcion", name: "RECEPCION" },
  { id: "d-jardinero", name: "JARDINERO" },
  { id: "d-jardineros", name: "JARDINEROS" },
  { id: "d-lavanderia", name: "LAVANDERIA" },
];

const SCHEDULES: SyncScheduleRef[] = [{ id: "s-matutino", name: "MATUTINO" }];

/** Persona del sistema con valores por defecto razonables. */
const user = (over: Partial<SyncUserRef> = {}): SyncUserRef => ({
  id: "u-1",
  username: "usuario",
  name: "GONZALEZ MARTINEZ RAFAEL",
  employeeNumber: null,
  active: true,
  role: "EMPLOYEE",
  departmentId: "d-recepcion",
  departmentName: "RECEPCION",
  jobTitle: null,
  linkedToClock: false,
  ...over,
});

/** Renglón del Excel con valores por defecto razonables. */
const row = (over: Partial<SyncSheetRow> = {}): SyncSheetRow => ({
  sheet: "S y S",
  row: 2,
  employeeNumber: "657",
  name: "GONZALEZ MARTINEZ RAFAEL",
  departmentName: "RECEPCION",
  jobTitle: "",
  payrollType: "S y S",
  scheduleName: "",
  ...over,
});

/** Clasifica un archivo contra un sistema mínimo. */
const classify = (
  rows: SyncSheetRow[],
  users: SyncUserRef[] = [],
  actorId: string | null = null
) => classifyEmployeeSync({ rows, users, departments: DEPARTMENTS, schedules: SCHEDULES, actorId });

/* ------------------------------------------------------------------ */
/* Texto                                                               */
/* ------------------------------------------------------------------ */

test.describe("normalización de texto", () => {
  test("compara sin acentos, mayúsculas ni espacios de más", () => {
    expect(normalizeKey("  Recepción  ")).toBe("RECEPCION");
    expect(normalizeKey("JOSÉ   DE NAZARET")).toBe("JOSE DE NAZARET");
    expect(normalizeKey("S y S")).toBe("S Y S");
    expect(normalizeKey(null)).toBe("");
  });

  test("el nombre se guarda tal cual, solo con espacios colapsados", () => {
    expect(normalizeName("  RAMIREZ   CASTAÑEDA  MARIA ANTONIETA ")).toBe(
      "RAMIREZ CASTAÑEDA MARIA ANTONIETA"
    );
    expect(normalizeName(undefined)).toBe("");
  });
});

test.describe("comparación de nombres", () => {
  test("el mismo nombre en otro orden cuenta como la misma persona", () => {
    expect(
      samePersonName("Rafael Gonzalez Martinez", "GONZALEZ MARTINEZ RAFAEL")
    ).toBe(true);
    expect(
      samePersonName("Maria de los Angeles Perez", "PEREZ MARIA ANGELES")
    ).toBe(true);
    expect(
      samePersonName("Rafael Gonzalez Martinez", "Rafael Gonzalez Lopez")
    ).toBe(false);
  });

  test("tolera erratas solo para no duplicar personas", () => {
    expect(
      nameLooksAlike("CORONA TORRES JUANA INES", "Juana Ines Coronado Torres")
    ).toBe(true);
    expect(
      nameLooksAlike("RODELO ELIZARRARAS IVAN ATZAEL", "Ivan Atzael Rodelo Elizarragas")
    ).toBe(true);
    expect(nameLooksAlike("JUAN PEREZ", "JUAN LOPEZ")).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* Número de empleado                                                  */
/* ------------------------------------------------------------------ */

test.describe("número de empleado", () => {
  test("el Excel se normaliza a dígitos sin ceros a la izquierda", () => {
    expect(parseEmployeeNumber("0657")).toEqual({
      ok: true,
      number: { value: "657", numeric: 657 },
    });
    expect(parseEmployeeNumber("000657")).toEqual({
      ok: true,
      number: { value: "657", numeric: 657 },
    });
    expect(parseEmployeeNumber(657)).toEqual({
      ok: true,
      number: { value: "657", numeric: 657 },
    });
  });

  test("distingue vacío de no numérico", () => {
    expect(parseEmployeeNumber("")).toEqual({
      ok: false,
      reason: "MISSING_EMPLOYEE_NUMBER",
    });
    expect(parseEmployeeNumber("A-12")).toEqual({
      ok: false,
      reason: "INVALID_EMPLOYEE_NUMBER",
    });
  });

  test("el número del sistema descarta el prefijo de área (misma regla del reloj)", () => {
    expect(systemPayrollNumber("010657")).toBe(657);
    expect(systemPayrollNumber("020918")).toBe(918);
    expect(systemPayrollNumber("0010005")).toBe(10005);
    expect(systemPayrollNumber("88")).toBe(88);
    expect(systemPayrollNumber("A123")).toBeNull();
    expect(systemPayrollNumber("")).toBeNull();
  });

  test("el empate es numérico entre el Excel y el sistema", () => {
    const excel = parseEmployeeNumber("657");
    expect(excel.ok).toBe(true);
    if (!excel.ok) return;
    expect(samePayrollNumber(excel.number, "010657")).toBe(true);
    expect(samePayrollNumber(excel.number, "657")).toBe(true);
    expect(samePayrollNumber(excel.number, "020918")).toBe(false);
    expect(samePayrollNumber(excel.number, null)).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* Tipo de nómina y credenciales                                       */
/* ------------------------------------------------------------------ */

test.describe("tipo de nómina", () => {
  test("normaliza las variantes del Excel oficial", () => {
    expect(parsePayrollType("S y S")).toBe("S y S");
    expect(parsePayrollType("SYS")).toBe("S y S");
    expect(parsePayrollType("sueldos y salarios")).toBe("S y S");
    expect(parsePayrollType("Lista de Raya")).toBe("Lista de Raya");
    expect(parsePayrollType("LR")).toBe("Lista de Raya");
    expect(parsePayrollType("  Eventual ")).toBe("Eventual");
    expect(parsePayrollType("")).toBeNull();
  });
});

test.describe("username y contraseña propuestos", () => {
  test("usa inicial del primer nombre + apellido paterno (APELLIDOS NOMBRE)", () => {
    expect(usernameBase("GARCIA URIAS JOSE DE NAZARET")).toBe("jgarcia");
    expect(usernameBase("LOPEZ SALAS ANA JESSICA")).toBe("alopez");
    expect(usernameBase("CRUZ BEATRIZ")).toBe("bcruz");
    expect(usernameBase("PONCE")).toBe("p");
    expect(usernameBase("")).toBe("empleado");
    expect(usernameBase("RAMIREZ CASTAÑEDA MARIA ANTONIETA")).toBe("mramirez");
    expect(usernameBase("PEÑA DE LA CRUZ JOSÉ")).toBe("lpena");
  });

  test("desambigua con sufijo numérico sin distinguir mayúsculas", () => {
    expect(proposeUsername("GARCIA URIAS JOSE DE NAZARET")).toBe("jgarcia");
    expect(proposeUsername("GARCIA URIAS JOSE DE NAZARET", ["JGARCIA"])).toBe("jgarcia2");
    expect(
      proposeUsername("GARCIA URIAS JOSE DE NAZARET", ["jgarcia", "jgarcia2"])
    ).toBe("jgarcia3");
  });

  test("la contraseña provisional es PTNV + semilla, mínimo 6 caracteres", () => {
    expect(proposedPassword("657")).toBe("PTNV657");
    expect(proposedPassword("7")).toBe("PTNV70");
    expect(provisionalPassword("bcruz")).toBe("PTNVbcruz");
  });
});

/* ------------------------------------------------------------------ */
/* Clasificación                                                       */
/* ------------------------------------------------------------------ */

test.describe("clasificación", () => {
  test("un alta con número propone departamento, horario y posición de nómina", () => {
    const result = classify([
      row({
        employeeNumber: "700",
        name: "NUEVO EMPLEADO PRUEBA",
        scheduleName: "MATUTINO",
        jobTitle: "AYUDANTE",
      }),
    ]);

    expect(result.altas).toHaveLength(1);
    expect(result.altas[0]).toMatchObject({
      row: 2,
      employeeNumber: "700",
      name: "NUEVO EMPLEADO PRUEBA",
      departmentId: "d-recepcion",
      departmentName: "RECEPCION",
      jobTitle: "AYUDANTE",
      payrollType: "S y S",
      scheduleId: "s-matutino",
      scheduleName: "MATUTINO",
      scheduleWarning: null,
      payrollOrder: 1,
      employeeNumberGenerated: false,
      proposedUsername: "pnuevo",
      proposedPassword: "PTNV700",
    });
    expect(result.order).toEqual([]);
    expect(result.porResolver).toEqual([]);
  });

  test("un departamento fuera del catálogo ya no bloquea el alta: se elige en pantalla", () => {
    const result = classify([
      row({ employeeNumber: "700", name: "NUEVO EMPLEADO PRUEBA", departmentName: "MOZOS" }),
    ]);
    expect(result.porResolver).toEqual([]);
    expect(result.altas[0]).toMatchObject({
      employeeNumber: "700",
      employeeNumberGenerated: false,
      departmentId: null,
      departmentName: "MOZOS",
    });
  });

  test("una fila SIN número y sin coincidencia es un alta con número generado", () => {
    const result = classify([row({ employeeNumber: "", name: "CRUZ BEATRIZ" })]);
    expect(result.altas).toHaveLength(1);
    // Sin números conocidos, la secuencia arranca en 1 y se guarda con 7 dígitos.
    expect(result.altas[0]).toMatchObject({
      employeeNumber: "0000001",
      employeeNumberGenerated: true,
      departmentId: "d-recepcion",
      payrollOrder: 1,
      proposedUsername: "bcruz",
      proposedPassword: "PTNV0000001",
    });
  });

  test("genera números únicos y consecutivos desde el máximo del sistema + archivo", () => {
    const result = classify(
      [
        row({ row: 2, employeeNumber: "", name: "PERSONA NUEVA UNO" }),
        row({ row: 3, employeeNumber: "", name: "PERSONA NUEVA DOS" }),
      ],
      // 130002 es el máximo conocido (el archivo no trae números): sigue 130003.
      [user({ employeeNumber: "0130002" })]
    );
    expect(result.altas.map((alta) => alta.employeeNumber)).toEqual([
      "0130003",
      "0130004",
    ]);
    expect(result.altas.every((alta) => alta.employeeNumberGenerated)).toBe(true);
    expect(result.altas.map((alta) => alta.proposedPassword)).toEqual([
      "PTNV0130003",
      "PTNV0130004",
    ]);
  });

  test("el número generado conserva su valor al normalizarlo (7 dígitos)", () => {
    const result = classify([row({ employeeNumber: "", name: "CRUZ BEATRIZ" })]);
    const generated = result.altas[0].employeeNumber;
    expect(generated).toHaveLength(7);
    // La regla del reloj solo recorta los de 6 dígitos: este no se toca.
    expect(systemPayrollNumber(generated)).toBe(Number(generated));
    expect(systemPayrollNumber(generated)).not.toBeNull();
  });

  test("no repite números generados ni choca con los existentes", () => {
    const existing = [
      user({ id: "u-1", username: "u1", employeeNumber: "0130002" }),
      user({ id: "u-2", username: "u2", employeeNumber: "0130005" }),
    ];
    const result = classify(
      [
        row({ row: 2, employeeNumber: "", name: "PERSONA NUEVA UNO" }),
        row({ row: 3, employeeNumber: "", name: "PERSONA NUEVA DOS" }),
        row({ row: 4, employeeNumber: "700", name: "PERSONA NUEVA TRES" }),
      ],
      existing
    );
    const numbers = result.altas.map((alta) => alta.employeeNumber);
    expect(new Set(numbers).size).toBe(numbers.length);
    // El máximo es 130005: la secuencia sigue en 130006, 130007.
    expect(numbers).toEqual(["0130006", "0130007", "700"]);
    expect(result.altas.map((alta) => alta.employeeNumberGenerated)).toEqual([
      true,
      true,
      false,
    ]);
  });

  test("una fila SIN número con un único match y mismos datos coincide", () => {
    const result = classify(
      [row({ employeeNumber: "", name: "GONZALEZ MARTINEZ RAFAEL" })],
      [user({ employeeNumber: "010657" })]
    );
    expect(result.coinciden).toBe(1);
    expect(result.cambios).toEqual([]);
    expect(result.order).toEqual([{ userId: "u-1", payrollOrder: 1 }]);
  });

  test("una fila SIN número con un único match pero otro departamento es un cambio", () => {
    const result = classify(
      [row({ employeeNumber: "", name: "GONZALEZ MARTINEZ RAFAEL", departmentName: "JARDINERO" })],
      [user({ employeeNumber: "010657" })]
    );
    expect(result.coinciden).toBe(0);
    expect(result.cambios).toEqual([
      {
        userId: "u-1",
        row: 2,
        rowKey: "S y S:2",
        employeeNumber: null,
        currentEmployeeNumber: "010657",
        excelName: "GONZALEZ MARTINEZ RAFAEL",
        currentName: "GONZALEZ MARTINEZ RAFAEL",
        excelDepartmentName: "JARDINERO",
        currentDepartmentName: "RECEPCION",
      },
    ]);
    expect(result.order).toEqual([{ userId: "u-1", payrollOrder: 1 }]);
  });

  test("una fila SIN número con varios matches queda AMBIGUOUS_NAME", () => {
    const result = classify(
      [row({ employeeNumber: "", name: "GONZALEZ MARTINEZ RAFAEL" })],
      [
        user({ id: "u-a", username: "rafael.gonzalez" }),
        user({ id: "u-b", username: "rgonzalez" }),
      ]
    );
    expect(result.altas).toEqual([]);
    expect(result.porResolver).toHaveLength(1);
    expect(result.porResolver[0]).toMatchObject({
      row: 2,
      payrollOrder: 1,
      employeeNumber: null,
      name: "GONZALEZ MARTINEZ RAFAEL",
      departmentName: "RECEPCION",
      departmentId: "d-recepcion",
      reason: "AMBIGUOUS_NAME",
      detail: "rafael.gonzalez, rgonzalez",
      candidates: [
        {
          userId: "u-a",
          name: "GONZALEZ MARTINEZ RAFAEL",
          employeeNumber: null,
          departmentName: "RECEPCION",
        },
        {
          userId: "u-b",
          name: "GONZALEZ MARTINEZ RAFAEL",
          employeeNumber: null,
          departmentName: "RECEPCION",
        },
      ],
      proposedUsername: "rgonzalez2",
      proposedPassword: "PTNVrgonzalez2",
    });
  });

  test("un usuario inactivo con ese número queda por resolver con el candidato", () => {
    const result = classify([row()], [
      user({ id: "u-inactivo", username: "inactivo", employeeNumber: "010657", active: false }),
    ]);
    expect(result.porResolver[0]).toMatchObject({
      row: 2,
      payrollOrder: 1,
      employeeNumber: "657",
      name: "GONZALEZ MARTINEZ RAFAEL",
      departmentName: "RECEPCION",
      departmentId: "d-recepcion",
      reason: "INACTIVE_USER_EXISTS",
      candidates: [
        {
          userId: "u-inactivo",
          name: "GONZALEZ MARTINEZ RAFAEL",
          employeeNumber: "010657",
          departmentName: "RECEPCION",
        },
      ],
      proposedUsername: "rgonzalez",
      proposedPassword: "PTNV657",
    });
  });

  test("NUMBER_MISMATCH queda por resolver con los candidatos activos", () => {
    const result = classify(
      [row({ employeeNumber: "916", name: "CORONA TORRES JUANA INES" })],
      [
        user({ id: "u-2", username: "juana.coronado", name: "CORONA TORRES JUANA INES", employeeNumber: "020918" }),
        user({ id: "u-3", username: "juana.corona", name: "CORONA TORRES JUANA INES", employeeNumber: "040918" }),
      ]
    );
    expect(result.porResolver[0]).toMatchObject({
      reason: "NUMBER_MISMATCH",
      payrollOrder: 1,
      departmentId: "d-recepcion",
      candidates: [
        { userId: "u-2", employeeNumber: "020918" },
        { userId: "u-3", employeeNumber: "040918" },
      ],
      proposedUsername: "jcorona",
      proposedPassword: "PTNV916",
    });
  });

  test("un número que no existe con un único nombre parecido es un cambio, no NUMBER_MISMATCH", () => {
    const result = classify(
      [row({ employeeNumber: "916", name: "CORONA TORRES JUANA INES" })],
      [
        user({
          id: "u-2",
          username: "jcorona",
          name: "CORONA TORRES JUANA INES",
          employeeNumber: "020918",
        }),
      ]
    );
    expect(result.altas).toEqual([]);
    expect(result.porResolver).toEqual([]);
    expect(result.cambios[0]).toMatchObject({
      employeeNumber: "916",
      currentEmployeeNumber: "020918",
    });
    expect(result.order).toEqual([{ userId: "u-2", payrollOrder: 1 }]);
  });

  test("un número que no existe con varios nombres parecidos queda NUMBER_MISMATCH", () => {
    const result = classify(
      [row({ employeeNumber: "916", name: "CORONA TORRES JUANA INES" })],
      [
        user({
          id: "u-2",
          username: "juana.coronado",
          name: "CORONA TORRES JUANA INES",
          employeeNumber: "020918",
        }),
        user({
          id: "u-3",
          username: "juana.corona",
          name: "CORONA TORRES JUANA INES",
          employeeNumber: "040918",
        }),
      ]
    );
    expect(result.cambios).toEqual([]);
    expect(result.porResolver[0]).toMatchObject({
      reason: "NUMBER_MISMATCH",
      employeeNumber: "916",
      detail: "juana.coronado, juana.corona",
    });
  });

  test("un número que ya es de una cuenta dada de baja no se da de alta", () => {
    const result = classify(
      [row()],
      [user({ employeeNumber: "010657", active: false })]
    );
    expect(result.altas).toEqual([]);
    expect(result.porResolver[0]).toMatchObject({
      reason: "INACTIVE_USER_EXISTS",
      employeeNumber: "657",
    });
  });

  test("un número repetido con el MISMO nombre (misma persona) va a por resolver en TODAS", () => {
    const result = classify([
      row({ row: 2, employeeNumber: "657" }),
      row({ row: 3, employeeNumber: "0657" }),
    ]);
    expect(result.porResolver.map((item) => item.reason)).toEqual([
      "DUPLICATE_EMPLOYEE_NUMBER",
      "DUPLICATE_EMPLOYEE_NUMBER",
    ]);
  });

  test("un número repetido con nombres distintos NO es duplicado: cada fila se resuelve", () => {
    // El Excel trae el número sin prefijo de área: 872 son dos personas.
    const result = classify(
      [
        row({ row: 2, employeeNumber: "872", name: "ESPINOZA ESPARZA JESSENIA" }),
        row({ row: 3, employeeNumber: "872", name: "LOPEZ MENDOZA JESSAMYN" }),
      ],
      [
        user({
          id: "u-jessenia",
          username: "jespinoza",
          name: "Jessenia Espinoza Esparza",
          employeeNumber: "060872",
        }),
        user({
          id: "u-jessamyn",
          username: "jlopez",
          name: "Jessamyn Lopez Mendoza",
          employeeNumber: "020872",
        }),
      ]
    );
    expect(result.porResolver).toEqual([]);
    expect(result.coinciden).toBe(2);
    expect(result.order).toEqual([
      { userId: "u-jessenia", payrollOrder: 1 },
      { userId: "u-jessamyn", payrollOrder: 2 },
    ]);
  });

  test("tres filas con el mismo número: si una cambia de nombre no es duplicado", () => {
    const result = classify([
      row({ row: 2, employeeNumber: "657", name: "PERSONA REPETIDA UNO" }),
      row({ row: 3, employeeNumber: "0657", name: "PERSONA REPETIDA UNO" }),
      row({ row: 4, employeeNumber: "657", name: "OTRA PERSONA DISTINTA" }),
    ]);
    expect(result.porResolver).toEqual([]);
    // La primera es alta, la segunda es el mismo nombre (dedupe) y la tercera
    // es otra persona: no se marca duplicado por compartir el número.
    expect(result.altas.map((alta) => alta.name)).toEqual([
      "PERSONA REPETIDA UNO",
      "OTRA PERSONA DISTINTA",
    ]);
    expect(result.coinciden).toBe(1);
  });

  test("número inválido y nombre vacío se reportan por separado", () => {
    const result = classify([
      row({ row: 2, employeeNumber: "A-12" }),
      row({ row: 3, employeeNumber: "800", name: "   " }),
    ]);
    expect(result.porResolver.map((item) => item.reason)).toEqual([
      "INVALID_EMPLOYEE_NUMBER",
      "MISSING_NAME",
    ]);
  });

  test("si el número se repite entre áreas, el nombre del Excel desempata", () => {
    const result = classify(
      [row({ employeeNumber: "872", name: "ESPINOZA ESPARZA JESSENIA" })],
      [
        user({
          id: "u-jessamyn",
          username: "jlopez",
          name: "Jessamyn Lopez Mendoza",
          employeeNumber: "060872",
        }),
        user({
          id: "u-jessenia",
          username: "jespinoza",
          name: "Jessenia Espinoza Esparza",
          employeeNumber: "010872",
        }),
      ]
    );
    expect(result.coinciden).toBe(1);
    expect(result.order).toEqual([{ userId: "u-jessenia", payrollOrder: 1 }]);
  });

  test("dedupe: la segunda aparición de la misma persona cuenta como coincidencia", () => {
    const jessenia = user({
      id: "u-jessenia",
      username: "jespinoza",
      name: "PEREZ CARDENAS AMELIA",
      employeeNumber: "010675",
      departmentId: "d-lavanderia",
      departmentName: "LAVANDERIA",
    });
    const result = classify(
      [
        // En "S y S" viene con número...
        row({
          row: 2,
          employeeNumber: "675",
          name: "PEREZ CARDENAS AMELIA",
          departmentName: "LAVANDERIA",
        }),
        // ...y en "Lista de Raya" otra vez, ahora sin número.
        row({
          row: 3,
          employeeNumber: "",
          name: "PEREZ CARDENAS AMELIA",
          departmentName: "LAVANDERIA",
        }),
      ],
      [jessenia]
    );
    expect(result.coinciden).toBe(2);
    expect(result.cambios).toEqual([]);
    expect(result.altas).toEqual([]);
    // Solo la primera aparición aporta su posición.
    expect(result.order).toEqual([{ userId: "u-jessenia", payrollOrder: 1 }]);
    expect(result.bajas).toEqual([]);
  });

  test("dedupe: dos filas nuevas con el mismo nombre proponen una sola alta", () => {
    const result = classify([
      row({ row: 2, employeeNumber: "700", name: "NUEVO EMPLEADO PRUEBA" }),
      row({ row: 3, employeeNumber: "", name: "NUEVO EMPLEADO PRUEBA" }),
    ]);
    expect(result.altas).toHaveLength(1);
    expect(result.altas[0]).toMatchObject({
      employeeNumber: "700",
      employeeNumberGenerated: false,
      payrollOrder: 1,
    });
    expect(result.coinciden).toBe(1);
  });

  test("las bajas excluyen a todo usuario que el archivo ya resolvió por nombre", () => {
    const result = classify(
      [row({ row: 2, employeeNumber: "", name: "GONZALEZ MARTINEZ RAFAEL" })],
      [user({ employeeNumber: "010657" })]
    );
    expect(result.cambios).toHaveLength(0);
    expect(result.coinciden).toBe(1);
    expect(result.bajas).toEqual([]);
  });

  test("las bajas son los activos con número o con reloj que no están en el Excel", () => {
    const result = classify([row()], [
      // Coincide: no es baja.
      user({ id: "u-match", employeeNumber: "010657" }),
      // Activo con número que no está en el Excel.
      user({
        id: "u-baja",
        username: "baja",
        name: "PERSONA QUE YA NO ESTA",
        employeeNumber: "020500",
        jobTitle: "RECEPCIONISTA",
      }),
      // Sin número ni reloj: cuenta de sistema, no se propone baja.
      user({ id: "u-sistema", username: "sistema", name: "CUENTA SIN NUMERO" }),
      // Sin número pero vinculado al reloj: sí es baja.
      user({
        id: "u-reloj",
        username: "reloj",
        name: "PERSONA DEL RELOJ",
        linkedToClock: true,
      }),
      // ADMIN: nunca se propone baja.
      user({ id: "u-admin", username: "admin", name: "ADMINISTRADOR", role: "ADMIN", employeeNumber: "020001" }),
      // Quien ejecuta: tampoco.
      user({ id: "u-actor", username: "actor", name: "QUIEN EJECUTA", employeeNumber: "020612" }),
      // Inactiva: no se propone baja (ya está dada de baja).
      user({ id: "u-inactivo", username: "inactivo", name: "YA INACTIVO", employeeNumber: "020700", active: false }),
    ], "u-actor");

    expect(result.bajas.map((baja) => baja.userId)).toEqual(["u-baja", "u-reloj"]);
    expect(result.bajas[0]).toMatchObject({
      employeeNumber: "020500",
      name: "PERSONA QUE YA NO ESTA",
      jobTitle: "RECEPCIONISTA",
      linkedToClock: false,
    });
    expect(result.bajas[1]).toMatchObject({ linkedToClock: true, employeeNumber: null });
  });

  test("una persona que viene en el Excel sin número tampoco se propone como baja", () => {
    const result = classify(
      [
        row({
          employeeNumber: "",
          name: "BARAJAS GONZALEZ SANDRA",
          departmentName: "RECEPCION",
        }),
      ],
      [
        user({
          id: "u-sin-numero",
          username: "sbarajas",
          name: "Sandra Barajas Gonzalez",
          employeeNumber: "030008",
        }),
      ]
    );
    expect(result.coinciden).toBe(1);
    expect(result.bajas).toEqual([]);
  });

  test("un usuario del sistema con número no numérico no empata y se propone baja", () => {
    const result = classify([row()], [
      user({ id: "u-raro", username: "raro", name: "NUMERO RARO", employeeNumber: "A123" }),
    ]);
    expect(result.bajas.map((baja) => baja.userId)).toEqual(["u-raro"]);
  });

  test("dos hojas pueden repetir el número de fila sin repetir rowKey", () => {
    const result = classify([
      row({ sheet: "S y S", row: 81, employeeNumber: "842", name: "LOPEZ OSORIO NICOLAS" }),
      row({ sheet: "Lista de Raya", row: 81, employeeNumber: "", name: "VAZQUEZ CASTRO RICARDO" }),
    ]);
    expect(result.altas.map((alta) => alta.rowKey)).toEqual([
      "S y S:81",
      "Lista de Raya:81",
    ]);
    // El número de fila sí se repite entre hojas: por eso hace falta el rowKey.
    expect(result.altas.map((alta) => alta.row)).toEqual([81, 81]);
    expect(new Set(result.altas.map((alta) => alta.rowKey)).size).toBe(2);
  });

  test("el orden de nómina sigue la posición de cada renglón", () => {
    const result = classify(
      [
        row({ row: 2, employeeNumber: "600", name: "PRIMERA PERSONA PRUEBA" }),
        row({ row: 3, employeeNumber: "", name: "SEGUNDA PERSONA PRUEBA" }),
        row({ row: 4, employeeNumber: "657" }),
      ],
      [user({ employeeNumber: "010657" })]
    );
    expect(result.altas.map((alta) => alta.payrollOrder)).toEqual([1, 2]);
    // La fila sin número propone el siguiente número al máximo conocido (657).
    expect(result.altas[0]).toMatchObject({
      employeeNumber: "600",
      employeeNumberGenerated: false,
    });
    expect(result.altas[1]).toMatchObject({
      employeeNumber: "0000658",
      employeeNumberGenerated: true,
    });
    expect(result.order).toEqual([{ userId: "u-1", payrollOrder: 3 }]);
  });
});
