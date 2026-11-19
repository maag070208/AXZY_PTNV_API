/**
 * Reglas puras de la sincronización de empleados desde el Excel oficial de
 * nómina (hoja `Empleados`). Aquí no hay base de datos ni Express: todo entra
 * por parámetros y sale por valores, para poder probarlo con el runner
 * unitario (`tests/unit/employee-sync-rules.spec.ts`) y para que el servicio
 * solo se encargue de leer la base y de escribir el resultado.
 *
 * Lo que decide este archivo:
 * - Normalización de textos y de números de empleado.
 * - Tipo de nómina del Excel ("S y S" / "Lista de Raya").
 * - Username y contraseña provisionales de un alta.
 * - Clasificación de cada renglón del Excel contra el sistema: altas, gente que
 *   ya coincide, cambios informativos, bajas (está en el sistema y ya no en el
 *   Excel) y renglones por resolver (sin número, número inválido o repetido,
 *   departamento desconocido, número que no cuadra con el nombre, etc.).
 */

/* -------------------------------------------------------------------------- */
/* Texto                                                                      */
/* -------------------------------------------------------------------------- */

const stripAccents = (value: string): string =>
  value.normalize("NFD").replace(/[\u0300-\u036f]/g, "");

/** Texto comparable: sin acentos, en mayúsculas y con los espacios colapsados. */
export const normalizeKey = (value: unknown): string =>
  stripAccents(String(value ?? ""))
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();

/** Nombre tal como se guarda: solo recorta y colapsa espacios (no reordena). */
export const normalizeName = (value: unknown): string =>
  String(value ?? "").replace(/\s+/g, " ").trim();

/** Parte de un username: minúsculas, sin acentos y solo `[a-z0-9]`. */
export const sanitizeUsernamePart = (value: string): string =>
  stripAccents(value)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

/* -------------------------------------------------------------------------- */
/* Número de empleado                                                         */
/* -------------------------------------------------------------------------- */

export type EmployeeNumberFailure =
  | "MISSING_EMPLOYEE_NUMBER"
  | "INVALID_EMPLOYEE_NUMBER";

/** Número del Excel ya normalizado. */
export interface ParsedEmployeeNumber {
  /** Dígitos sin ceros a la izquierda: es el valor que se guarda en el alta. */
  value: string;
  /** El mismo número como entero: la llave de comparación con el sistema. */
  numeric: number;
}

export type EmployeeNumberResult =
  | { ok: true; number: ParsedEmployeeNumber }
  | { ok: false; reason: EmployeeNumberFailure };

/**
 * Lee el NUM_EMPLEADO del Excel: tolera que la celda venga como número o como
 * texto, exige solo dígitos y quita los ceros a la izquierda ("070562" → "562").
 * Vacío y no numérico se distinguen porque RH los corrige distinto.
 */
export const parseEmployeeNumber = (raw: unknown): EmployeeNumberResult => {
  const text =
    typeof raw === "number" ? String(Math.trunc(raw)) : String(raw ?? "").trim();
  if (!text) return { ok: false, reason: "MISSING_EMPLOYEE_NUMBER" };
  if (!/^\d+$/.test(text)) return { ok: false, reason: "INVALID_EMPLOYEE_NUMBER" };
  const value = text.replace(/^0+/, "") || "0";
  return { ok: true, number: { value, numeric: Number(value) } };
};

/**
 * Número de nómina de una persona del sistema. En la base del cliente el
 * `employeeNumber` guarda el prefijo de área ("010657" = área 01 + nómina 657),
 * mientras el Excel oficial trae el número sin prefijo ("657"). Se aplica la
 * MISMA regla que el padrón del reloj (`clockPayroll` en
 * `time-clock-employees.service.ts`): exactamente 6 dígitos → se descartan los
 * 2 del prefijo; si no, el número tal cual (solo si es numérico).
 *
 * No se inventan prefijos de área: la comparación es numérica.
 */
export const systemPayrollNumber = (raw: unknown): number | null => {
  const text =
    typeof raw === "number" ? String(Math.trunc(raw)) : String(raw ?? "").trim();
  if (!text) return null;
  if (/^\d{6}$/.test(text)) return Number(text.slice(2));
  return /^\d+$/.test(text) ? Number(text) : null;
};

/** ¿El número del Excel es el mismo que el `employeeNumber` del sistema? */
export const samePayrollNumber = (
  excel: ParsedEmployeeNumber,
  employeeNumber: string | null
): boolean => systemPayrollNumber(employeeNumber) === excel.numeric;

/* -------------------------------------------------------------------------- */
/* Tipo de nómina                                                             */
/* -------------------------------------------------------------------------- */

/** Valores canónicos del tipo de nómina del Excel oficial. */
export const PAYROLL_TYPE_SALARY = "S y S";
export const PAYROLL_TYPE_PAYROLL = "Lista de Raya";

const SALARY_ALIASES = new Set([
  "S Y S",
  "SYSS",
  "SYS",
  "SUELDOS Y SALARIOS",
  "SUELDO Y SALARIO",
]);
const PAYROLL_ALIASES = new Set([
  "LISTA DE RAYA",
  "LISTA RAYA",
  "RAYA",
  "LR",
]);

/**
 * Normaliza el TIPO_NOMINA del Excel. Un valor desconocido se conserva tal
 * cual (recortado) porque es informativo: no bloquea el alta ni la baja.
 */
export const parsePayrollType = (raw: unknown): string | null => {
  const text = normalizeName(raw);
  if (!text) return null;
  const key = normalizeKey(text);
  if (SALARY_ALIASES.has(key)) return PAYROLL_TYPE_SALARY;
  if (PAYROLL_ALIASES.has(key)) return PAYROLL_TYPE_PAYROLL;
  return text;
};

/* -------------------------------------------------------------------------- */
/* Username y contraseña propuestos                                           */
/* -------------------------------------------------------------------------- */

/**
 * Base del username con la convención del sistema: inicial del primer nombre +
 * apellido paterno, en minúsculas y sin acentos (`apalma` = Ana Palma).
 *
 * El Excel no parte nombres y apellidos: el nombre completo viene en el orden
 * "APELLIDOS NOMBRE(S)". La heurística es:
 * - 3 o más palabras: apellido paterno = 1ª, primer nombre = 3ª.
 * - 2 palabras: apellido paterno = 1ª, nombre = 2ª.
 * - 1 palabra: se toma como nombre (no hay apellido que anteponer).
 *
 * Es solo una propuesta editable en pantalla (los nombres compuestos o con
 * partículas como "DE LA CRUZ" pueden necesitar que RH lo ajuste).
 */
export const usernameBase = (fullName: string): string => {
  const tokens = normalizeName(fullName).split(" ").filter(Boolean);
  if (tokens.length === 0) return "empleado";
  const paternal = tokens.length >= 2 ? tokens[0] : "";
  const first =
    tokens.length >= 3 ? tokens[2] : tokens.length === 2 ? tokens[1] : tokens[0];
  const base = sanitizeUsernamePart(`${first.slice(0, 1)}${paternal}`);
  return base || "empleado";
};

/**
 * Propone el username del alta y lo desambigua con sufijo numérico si ya está
 * usado, comparando sin distinguir mayúsculas (`jperez`, `jperez2`, …). El
 * llamador va agregando a `taken` los usernames propuestos para que dos filas
 * del mismo archivo tampoco choquen.
 */
export const proposeUsername = (
  fullName: string,
  taken: Iterable<string> = []
): string => {
  const used = new Set<string>();
  for (const value of taken) used.add(String(value).toLowerCase());
  const base = usernameBase(fullName);
  let candidate = base;
  for (let suffix = 2; used.has(candidate); suffix++) {
    candidate = `${base}${suffix}`;
  }
  return candidate;
};

/**
 * Contraseña provisional del alta: `PTNV` + número de empleado, con mínimo 6
 * caracteres (se rellena con ceros para números de un solo dígito).
 */
export const proposedPassword = (employeeNumber: string): string => {
  const password = `PTNV${employeeNumber}`;
  return password.length >= 6 ? password : password.padEnd(6, "0");
};

/* -------------------------------------------------------------------------- */
/* Clasificación                                                              */
/* -------------------------------------------------------------------------- */

/** Un renglón del Excel ya mapeado a sus columnas útiles. */
export interface SyncSheetRow {
  /** Número de fila en Excel (2 = primer renglón de datos). */
  row: number;
  /** NUM_EMPLEADO tal como viene en la celda (sin normalizar). */
  employeeNumber: string;
  name: string;
  departmentName: string;
  jobTitle: string;
  payrollType: string;
  scheduleName: string;
}

/** Persona del sistema con lo mínimo para cruzar el Excel. */
export interface SyncUserRef {
  id: string;
  username: string;
  name: string;
  employeeNumber: string | null;
  active: boolean;
  role: string;
  departmentId: string | null;
  departmentName: string | null;
  jobTitle: string | null;
  /** Está vinculada en `time_clock_employees` (padrón del reloj). */
  linkedToClock: boolean;
}

export interface SyncDepartmentRef {
  id: string;
  name: string;
}

export interface SyncScheduleRef {
  id: string;
  name: string;
}

/** Alta propuesta: se crea al confirmar (con username/password editables). */
export interface EmployeeSyncAlta {
  row: number;
  employeeNumber: string;
  name: string;
  departmentName: string;
  departmentId: string;
  jobTitle: string | null;
  payrollType: string | null;
  scheduleName: string | null;
  scheduleId: string | null;
  /** "SCHEDULE_NOT_FOUND" cuando el HORARIO del Excel no está en el catálogo. */
  scheduleWarning: string | null;
  proposedUsername: string;
  proposedPassword: string;
}

/** Baja propuesta: está activa en el sistema y no aparece en el Excel. */
export interface EmployeeSyncBaja {
  userId: string;
  employeeNumber: string | null;
  name: string;
  departmentName: string | null;
  jobTitle: string | null;
  linkedToClock: boolean;
}

/** Renglón que ya existe pero con datos distintos: aplicar es opcional. */
export interface EmployeeSyncCambio {
  userId: string;
  row: number;
  employeeNumber: string;
  excelName: string;
  currentName: string;
  excelDepartmentName: string;
  currentDepartmentName: string | null;
}

export type EmployeeSyncUnresolvedReason =
  | "MISSING_EMPLOYEE_NUMBER"
  | "INVALID_EMPLOYEE_NUMBER"
  | "DUPLICATE_EMPLOYEE_NUMBER"
  | "MISSING_NAME"
  | "DEPARTMENT_NOT_FOUND"
  | "INACTIVE_USER_EXISTS"
  | "NUMBER_MISMATCH"
  | "NAME_MATCHES_OTHER_USER";

/** Renglón que RH tiene que revisar/corregir antes de aplicar el archivo. */
export interface EmployeeSyncUnresolved {
  row: number;
  employeeNumber: string | null;
  name: string | null;
  departmentName: string | null;
  reason: EmployeeSyncUnresolvedReason;
  detail?: string;
}

export interface EmployeeSyncClassification {
  altas: EmployeeSyncAlta[];
  bajas: EmployeeSyncBaja[];
  /** Cuántos renglones ya están idénticos en el sistema (no se listan). */
  coinciden: number;
  cambios: EmployeeSyncCambio[];
  porResolver: EmployeeSyncUnresolved[];
}

export interface ClassifyEmployeeSyncInput {
  rows: SyncSheetRow[];
  users: SyncUserRef[];
  departments: SyncDepartmentRef[];
  schedules: SyncScheduleRef[];
  /** Quien ejecuta el preview: nunca se propone darlo de baja a sí mismo. */
  actorId?: string | null;
}

/** El HORARIO del Excel no está en el catálogo: RH lo elige en pantalla. */
export const SCHEDULE_NOT_FOUND_WARNING = "SCHEDULE_NOT_FOUND";

const findByName = <T extends { name: string }>(
  items: T[],
  wanted: string
): T | null => {
  const key = normalizeKey(wanted);
  if (!key) return null;
  return items.find((item) => normalizeKey(item.name) === key) ?? null;
};

/**
 * Clasifica el archivo completo contra el estado del sistema. Función pura: el
 * servicio le pasa los usuarios, departamentos y horarios ya leídos de la base,
 * de modo que lo que RH revisa en el preview es exactamente esta clasificación.
 *
 * Reglas (contrato de la sincronización):
 * - El cruce con el sistema SIEMPRE es por número de empleado (comparación
 *   numérica con la regla del prefijo de área, ver `systemPayrollNumber`); el
 *   nombre solo desempata/protege cuando el número no existe en el sistema.
 * - Un número repetido dentro del archivo va a `porResolver` en TODAS sus
 *   apariciones.
 * - Un usuario del sistema que no está en el Excel se propone como baja solo si
 *   tiene número o está vinculado al reloj, nunca si es ADMIN ni si es quien
 *   ejecuta la sincronización.
 */
export const classifyEmployeeSync = (
  input: ClassifyEmployeeSyncInput
): EmployeeSyncClassification => {
  const { rows, users, departments, schedules, actorId } = input;

  // Números del Excel ya normalizados y ocurrencias (para detectar repetidos).
  const parsed = rows.map((row) => parseEmployeeNumber(row.employeeNumber));
  const occurrences = new Map<number, number>();
  for (const result of parsed) {
    if (!result.ok) continue;
    occurrences.set(
      result.number.numeric,
      (occurrences.get(result.number.numeric) ?? 0) + 1
    );
  }

  // Índice del sistema por número de nómina. Si dos cuentas comparten número,
  // gana la activa: es la que el Excel "ya tiene" y la que no debe duplicarse.
  const userByNumber = new Map<number, SyncUserRef>();
  for (const user of users) {
    const numeric = systemPayrollNumber(user.employeeNumber);
    if (numeric === null) continue;
    const current = userByNumber.get(numeric);
    if (!current || (!current.active && user.active)) {
      userByNumber.set(numeric, user);
    }
  }

  // Nombres de personas activas: solo se usan para avisar de un posible número
  // equivocado (nombre que sí existe con otro número o sin número).
  const activeByName = new Map<string, SyncUserRef[]>();
  for (const user of users) {
    if (!user.active) continue;
    const key = normalizeKey(user.name);
    if (!key) continue;
    activeByName.set(key, [...(activeByName.get(key) ?? []), user]);
  }

  const altas: EmployeeSyncAlta[] = [];
  const cambios: EmployeeSyncCambio[] = [];
  const porResolver: EmployeeSyncUnresolved[] = [];
  let coinciden = 0;

  // Usernames ya ocupados (base) + los que este mismo archivo va proponiendo.
  const takenUsernames = new Set<string>(
    users.map((user) => user.username.toLowerCase())
  );

  rows.forEach((row, index) => {
    const number = parsed[index];
    const name = normalizeName(row.name);
    const departmentName = normalizeName(row.departmentName);
    const department = findByName(departments, departmentName);

    const unresolved = (
      reason: EmployeeSyncUnresolvedReason,
      employeeNumber: string | null,
      detail?: string
    ): void => {
      porResolver.push({
        row: row.row,
        employeeNumber,
        name: name || null,
        departmentName: departmentName || null,
        reason,
        ...(detail !== undefined ? { detail } : {}),
      });
    };

    // 1) Número: obligatorio, numérico y sin repetirse dentro del archivo.
    if (!number.ok) {
      unresolved(
        number.reason,
        number.reason === "INVALID_EMPLOYEE_NUMBER"
          ? normalizeName(row.employeeNumber) || null
          : null
      );
      return;
    }
    if ((occurrences.get(number.number.numeric) ?? 0) > 1) {
      unresolved("DUPLICATE_EMPLOYEE_NUMBER", number.number.value);
      return;
    }

    // 2) Nombre y departamento: obligatorios para poder dar de alta.
    if (!name) {
      unresolved("MISSING_NAME", number.number.value);
      return;
    }
    if (!department) {
      unresolved("DEPARTMENT_NOT_FOUND", number.number.value, departmentName);
      return;
    }

    // 3) ¿El número ya existe en el sistema?
    const existing = userByNumber.get(number.number.numeric);
    if (existing) {
      if (!existing.active) {
        unresolved("INACTIVE_USER_EXISTS", number.number.value, existing.username);
        return;
      }
      const sameName = normalizeKey(existing.name) === normalizeKey(name);
      const sameDepartment = existing.departmentId === department.id;
      if (sameName && sameDepartment) {
        coinciden += 1;
        return;
      }
      cambios.push({
        userId: existing.id,
        row: row.row,
        employeeNumber: number.number.value,
        excelName: name,
        currentName: existing.name,
        excelDepartmentName: department.name,
        currentDepartmentName: existing.departmentName,
      });
      return;
    }

    // 4) El número no existe: si el nombre ya es de una persona activa, no se
    //    crea un duplicado; se avisa para que RH corrija el número del Excel.
    const sameNameUsers = activeByName.get(normalizeKey(name)) ?? [];
    if (sameNameUsers.length > 0) {
      const withNumber = sameNameUsers.find(
        (user) => systemPayrollNumber(user.employeeNumber) !== null
      );
      unresolved(
        withNumber ? "NUMBER_MISMATCH" : "NAME_MATCHES_OTHER_USER",
        number.number.value,
        withNumber?.employeeNumber ?? sameNameUsers[0]?.username
      );
      return;
    }

    // 5) Alta: se resuelve el horario (opcional) y se proponen credenciales.
    const schedule = row.scheduleName
      ? findByName(schedules, row.scheduleName)
      : null;
    const proposedUsername = proposeUsername(name, takenUsernames);
    takenUsernames.add(proposedUsername);
    altas.push({
      row: row.row,
      employeeNumber: number.number.value,
      name,
      departmentName: department.name,
      departmentId: department.id,
      jobTitle: normalizeName(row.jobTitle) || null,
      payrollType: parsePayrollType(row.payrollType),
      scheduleName: row.scheduleName
        ? schedule?.name ?? normalizeName(row.scheduleName)
        : null,
      scheduleId: schedule?.id ?? null,
      scheduleWarning:
        row.scheduleName && !schedule ? SCHEDULE_NOT_FOUND_WARNING : null,
      proposedUsername,
      proposedPassword: proposedPassword(number.number.value),
    });
  });

  // Bajas: activos del sistema que no están en el Excel. Solo se consideran las
  // cuentas "de nómina" (con número) o las vinculadas al reloj: una cuenta sin
  // número y sin reloj puede ser una cuenta de sistema que no viene del Excel.
  const excelNumbers = new Set<number>();
  for (const result of parsed) {
    if (result.ok) excelNumbers.add(result.number.numeric);
  }
  const bajas: EmployeeSyncBaja[] = users
    .filter((user) => {
      if (!user.active) return false;
      if (user.id === actorId) return false;
      if (user.role === "ADMIN") return false;
      const hasNumber = normalizeName(user.employeeNumber) !== "";
      if (!hasNumber && !user.linkedToClock) return false;
      const numeric = systemPayrollNumber(user.employeeNumber);
      // Un número no numérico nunca puede empatar con el Excel: cuenta como baja.
      if (numeric !== null && excelNumbers.has(numeric)) return false;
      return true;
    })
    .map((user) => ({
      userId: user.id,
      employeeNumber: user.employeeNumber,
      name: user.name,
      departmentName: user.departmentName,
      jobTitle: user.jobTitle,
      linkedToClock: user.linkedToClock,
    }));

  return { altas, bajas, coinciden, cambios, porResolver };
};
