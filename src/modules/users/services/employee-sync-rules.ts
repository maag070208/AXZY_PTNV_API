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

/* -------------------------------------------------------------------------- */
/* Comparación de nombres                                                     */
/* -------------------------------------------------------------------------- */

/** Partículas que no distinguen a nadie ("MARIA DE LOS ANGELES"). */
const NAME_PARTICLES = new Set(["DE", "DEL", "LA", "LAS", "LOS", "Y"]);

/**
 * Palabras del nombre en mayúsculas, sin acentos, sin partículas y sin letras
 * sueltas. El Excel trae "APELLIDOS NOMBRE(S)" y el sistema puede tener el
 * nombre en otro orden (o partido en nombre + apellidos): se compara por
 * palabras, no por la cadena completa.
 */
export const nameWords = (value: unknown): string[] =>
  stripAccents(String(value ?? ""))
    .toUpperCase()
    .split(/[^A-Z]+/)
    .filter((word) => word.length > 1 && !NAME_PARTICLES.has(word));

/** Mismas palabras (en cualquier orden y con repeticiones) en ambos nombres. */
export const sameNameWords = (left: string[], right: string[]): boolean => {
  const a = [...left].sort();
  const b = [...right].sort();
  return a.length > 0 && a.length === b.length && a.every((word, index) => word === b[index]);
};

/**
 * ¿Es el mismo nombre? Mismas palabras en cualquier orden (y repetidas, porque
 * se comparan multiconjuntos). Es la regla de "nombre normalizado igual" para
 * dar un renglón por coincidente.
 */
export const samePersonName = (a: unknown, b: unknown): boolean =>
  sameNameWords(nameWords(a), nameWords(b));

/**
 * Nombre que "suena a la misma persona" aunque cambie el orden o alguna letra:
 * al menos 2 palabras en común. Es la heurística del padrón del reloj
 * (`nameMatches`), relajada a 2 palabras a propósito: la sincronización de
 * nómina prefiere que un homónimo quede POR RESOLVER antes que crear una cuenta
 * duplicada. El archivo real trae erratas como "ELIZARRARAS/ELIZARRAGAS" o
 * "CORONA/CORONADO" que así sí se detectan; RH corrige el número en el Excel.
 */
export const looksAlikeWords = (left: string[], right: string[]): boolean => {
  if (left.length === 0 || right.length === 0) return false;
  const rightSet = new Set(right);
  const common = new Set(left.filter((word) => rightSet.has(word))).size;
  return common >= 2;
};

export const nameLooksAlike = (a: unknown, b: unknown): boolean =>
  looksAlikeWords(nameWords(a), nameWords(b));

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
 * Contraseña provisional del alta: `PTNV` + semilla (número de empleado o, si
 * el Excel operativo no trae número, el username propuesto), con mínimo 6
 * caracteres. Es editable en pantalla antes de confirmar.
 */
export const provisionalPassword = (seed: string): string => {
  const password = `PTNV${seed}`;
  return password.length >= 6 ? password : password.padEnd(6, "0");
};

/** Contraseña provisional a partir del número de empleado (`PTNV657`). */
export const proposedPassword = (employeeNumber: string): string =>
  provisionalPassword(employeeNumber);

/**
 * Generador de números de empleado para quien llega sin número ("si no tiene
 * número se lo ponemos"). Arranca en el máximo conocido + 1 y avanza sin
 * chocar con los números normalizados ni con los literales ya usados. Lo usan
 * el preview (personas del archivo) y la confirmación (BD + payload).
 */
export const createEmployeeNumberGenerator = (taken: {
  numbers?: Iterable<number>;
  literals?: Iterable<string>;
}): (() => string) => {
  const numbers = new Set<number>(taken.numbers ?? []);
  const literals = new Set<string>(taken.literals ?? []);
  let candidate = 1;
  for (const value of numbers) candidate = Math.max(candidate, value + 1);
  return () => {
    for (;;) {
      const value = formatGeneratedEmployeeNumber(candidate);
      if (!numbers.has(candidate) && !literals.has(value)) {
        numbers.add(candidate);
        literals.add(value);
        candidate += 1;
        return value;
      }
      candidate += 1;
    }
  };
};

/* -------------------------------------------------------------------------- */
/* Clasificación                                                              */
/* -------------------------------------------------------------------------- */

/** Un renglón del Excel ya mapeado a sus columnas útiles. */
export interface SyncSheetRow {
  /** Nombre de la hoja de la que sale el renglón ("S y S", "Lista de Raya", …). */
  sheet: string;
  /** Número de fila en Excel (2 = primer renglón de datos). */
  row: number;
  /** NUM_EMPLEADO tal como viene en la celda (sin normalizar, "" = sin número). */
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

/** Alta propuesta: se crea al confirmar (con username/password/editables). */
export interface EmployeeSyncAlta {
  row: number;
  /** Identidad única del renglón en todo el archivo (`hoja:fila`, p. ej. "S y S:81"). */
  rowKey: string;
  /** Número de empleado con el que se dará de alta; si el Excel no lo trae, se genera. */
  employeeNumber: string;
  /** `true` cuando el número no venía en el Excel y lo propuso el sistema (editable). */
  employeeNumberGenerated: boolean;
  name: string;
  /** Nombre del departamento del Excel (el del catálogo si se pudo resolver). */
  departmentName: string;
  /** `null` cuando el departamento del Excel no está en el catálogo: RH lo elige. */
  departmentId: string | null;
  jobTitle: string | null;
  payrollType: string | null;
  scheduleName: string | null;
  scheduleId: string | null;
  /** "SCHEDULE_NOT_FOUND" cuando el HORARIO del Excel no está en el catálogo. */
  scheduleWarning: string | null;
  /** Posición global en el Excel (1..N): orden de la pre-nómina. */
  payrollOrder: number;
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
  /** Identidad única del renglón en todo el archivo (`hoja:fila`). */
  rowKey: string;
  /** Número del Excel (`null` en las filas sin número, p. ej. "Lista de Raya"). */
  employeeNumber: string | null;
  /** Número que ya tiene la persona en el sistema (se muestra para comparar). */
  currentEmployeeNumber: string | null;
  excelName: string;
  currentName: string;
  excelDepartmentName: string;
  currentDepartmentName: string | null;
}

/** Orden de nómina que ya existe en el sistema (se actualiza al confirmar). */
export interface EmployeeSyncOrderEntry {
  userId: string;
  payrollOrder: number;
}

/**
 * Motivos por los que un renglón queda por resolver. `MISSING_EMPLOYEE_NUMBER`
 * y `NAME_MATCHES_OTHER_USER` se conservan por compatibilidad con versiones
 * anteriores de la web, pero ya NO se emiten: el Excel sin número se resuelve
 * por nombre y, si no hay coincidencia, el alta propone un número generado.
 */
export type EmployeeSyncUnresolvedReason =
  | "MISSING_EMPLOYEE_NUMBER"
  | "INVALID_EMPLOYEE_NUMBER"
  | "DUPLICATE_EMPLOYEE_NUMBER"
  | "MISSING_NAME"
  | "DEPARTMENT_NOT_FOUND"
  | "INACTIVE_USER_EXISTS"
  | "NUMBER_MISMATCH"
  | "NAME_MATCHES_OTHER_USER"
  | "AMBIGUOUS_NAME";

/** Usuario del sistema que "suena" a una fila pendiente (para resolverla en pantalla). */
export interface EmployeeSyncCandidate {
  userId: string;
  name: string;
  employeeNumber: string | null;
  departmentName: string | null;
}

/** Renglón que RH tiene que revisar/corregir antes de aplicar el archivo. */
export interface EmployeeSyncUnresolved {
  row: number;
  /** Identidad única del renglón en todo el archivo (`hoja:fila`). */
  rowKey: string;
  /** Posición del renglón en el archivo (1..N): sirve para aplicarle `order`. */
  payrollOrder: number;
  employeeNumber: string | null;
  name: string | null;
  departmentName: string | null;
  /** Departamento del Excel resuelto contra el catálogo (`null` si no existe). */
  departmentId: string | null;
  reason: EmployeeSyncUnresolvedReason;
  detail?: string;
  /** Usuarios con los que RH puede vincular la fila (vacío si no aplica). */
  candidates: EmployeeSyncCandidate[];
  /** Propuesta de alta (usuario y contraseña) si RH decide que es persona nueva. */
  proposedUsername: string;
  proposedPassword: string;
}

export interface EmployeeSyncClassification {
  altas: EmployeeSyncAlta[];
  bajas: EmployeeSyncBaja[];
  /** Cuántos renglones ya están idénticos (o son repetidos de una persona ya resuelta). */
  coinciden: number;
  cambios: EmployeeSyncCambio[];
  porResolver: EmployeeSyncUnresolved[];
  /** Posición de nómina de las personas ya resueltas (sin duplicados, gana la primera aparición). */
  order: EmployeeSyncOrderEntry[];
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

const hasText = (value: string | null | undefined): boolean =>
  normalizeName(value) !== "";

/** Largo del número generado: 7 dígitos para que la regla del reloj NO le recorte 2. */
const GENERATED_EMPLOYEE_NUMBER_WIDTH = 7;

/** Número generado como string de 7 dígitos (`130003` → `"0130003"`). */
export const formatGeneratedEmployeeNumber = (value: number): string =>
  String(value).padStart(GENERATED_EMPLOYEE_NUMBER_WIDTH, "0");

/**
 * Clasifica el archivo completo contra el estado del sistema. Función pura: el
 * servicio le pasa los usuarios, departamentos y horarios ya leídos de la base,
 * de modo que lo que RH revisa en el preview es exactamente esta clasificación.
 *
 * Reglas:
 * - Fila CON número: se cruza por número (comparación numérica con la regla del
 *   prefijo de área, `systemPayrollNumber`). Si el número no existe pero el
 *   nombre ya es de UNA persona activa, es un cambio (el Excel trae otro
 *   número); si el nombre es de varias, queda `NUMBER_MISMATCH`.
 * - Fila SIN número (p. ej. "Lista de Raya"): se completa por nombre. Un solo
 *   usuario activo → coincidencia o cambio; varios → `AMBIGUOUS_NAME`; ninguno
 *   → alta sin número.
 * - El departamento del Excel se resuelve contra el catálogo (también inactivos)
 *   solo para comparar; en las altas es opcional (`departmentId: null`).
 * - Dedupe: si una persona ya fue resuelta por otra fila (pasa en quienes
 *   aparecen en "S y S" y otra vez en "Lista de Raya"), la fila siguiente cuenta
 *   como coincidente y no se duplica alta/cambio ni se propone su baja.
 * - Bajas: activos con número o reloj que no aparecen en el archivo (ni por
 *   número ni por nombre), nunca ADMIN ni quien ejecuta.
 */
export const classifyEmployeeSync = (
  input: ClassifyEmployeeSyncInput
): EmployeeSyncClassification => {
  const { rows, users, departments, schedules, actorId } = input;

  // Número del Excel: "" significa "sin número" (se completa por nombre); un
  // valor no numérico es un error de captura. El índice de la fila en el
  // arreglo es la posición global de nómina (1..N).
  const parsed = rows.map((row) =>
    hasText(row.employeeNumber) ? parseEmployeeNumber(row.employeeNumber) : null
  );
  // Duplicado REAL: el mismo número repetido con el MISMO nombre (la misma
  // persona capturada dos veces). El Excel de RH trae el número sin el prefijo
  // de área y ese número se repite entre áreas para personas distintas (872 =
  // Jessenia en RECEPCION y Jessamyn en A&B), así que un número repetido con
  // nombres distintos NO es un duplicado: cada fila sigue su cruce normal y
  // `userForNumber` desempata por nombre.
  const rowsByNumber = new Map<number, number[]>();
  for (let index = 0; index < parsed.length; index++) {
    const result = parsed[index];
    if (!result || !result.ok) continue;
    rowsByNumber.set(result.number.numeric, [
      ...(rowsByNumber.get(result.number.numeric) ?? []),
      index,
    ]);
  }
  const duplicatedNumbers = new Set<number>();
  for (const [numeric, indexes] of rowsByNumber) {
    if (indexes.length < 2) continue;
    const firstName = rows[indexes[0]].name;
    const sameRowName = indexes.every((index) =>
      samePersonName(rows[index].name, firstName)
    );
    if (sameRowName) duplicatedNumbers.add(numeric);
  }

  // Número de empleado para las personas que el Excel no numera ("si no tiene
  // número se lo ponemos"): se arranca en el máximo de nómina conocido (sistema
  // + archivo) + 1 y se va consumiendo en orden de archivo. Se guarda como
  // string de 7 dígitos: `systemPayrollNumber` solo recorta los de 6, así que
  // el valor se conserva al comparar contra el sistema y contra el reloj.
  const takenNumbers = new Set<number>();
  const takenNumberLiterals = new Set<string>();
  for (const user of users) {
    const raw = normalizeName(user.employeeNumber);
    if (!raw) continue;
    takenNumberLiterals.add(raw);
    const numeric = systemPayrollNumber(raw);
    if (numeric !== null) takenNumbers.add(numeric);
  }
  for (const result of parsed) {
    if (!result || !result.ok) continue;
    takenNumbers.add(result.number.numeric);
  }
  const generateEmployeeNumber = createEmployeeNumberGenerator({
    numbers: takenNumbers,
    literals: takenNumberLiterals,
  });

  // Índice del sistema por número de nómina. El número de nómina se repite
  // entre áreas (040001 y 110001), así que puede haber varias personas con el
  // mismo número comparable: se guardan todas y el nombre desempata al cruzar.
  const usersByNumber = new Map<number, SyncUserRef[]>();
  for (const user of users) {
    const numeric = systemPayrollNumber(user.employeeNumber);
    if (numeric === null) continue;
    usersByNumber.set(numeric, [...(usersByNumber.get(numeric) ?? []), user]);
  }

  /**
   * Persona del sistema que corresponde a un número del Excel. Si el número se
   * repite entre áreas, gana la que tiene el mismo nombre; si ninguna coincide,
   * la activa (para reportar el cambio en vez de inventar una coincidencia).
   */
  const userForNumber = (
    numeric: number,
    name: string
  ): SyncUserRef | undefined => {
    const candidates = usersByNumber.get(numeric) ?? [];
    if (candidates.length === 0) return undefined;
    const exact = candidates.filter((user) => samePersonName(user.name, name));
    const alike = candidates.filter((user) => nameLooksAlike(user.name, name));
    const pool = exact.length > 0 ? exact : alike.length > 0 ? alike : candidates;
    return pool.find((user) => user.active) ?? pool[0];
  };

  // Personas activas: se usan para completar las filas sin número y para
  // detectar que el nombre ya existe con otro número.
  const activeCandidates = users.filter((user) => user.active);

  type NameResolution =
    | { kind: "none" }
    | { kind: "one"; user: SyncUserRef }
    | { kind: "ambiguous"; users: SyncUserRef[] };

  /** Resuelve una persona activa por nombre: exacto (mismas palabras) y, si no, parecido. */
  const resolveByName = (name: string): NameResolution => {
    const exact = activeCandidates.filter((user) => samePersonName(user.name, name));
    if (exact.length === 1) return { kind: "one", user: exact[0] };
    if (exact.length > 1) return { kind: "ambiguous", users: exact };
    const alike = activeCandidates.filter((user) => nameLooksAlike(user.name, name));
    if (alike.length === 1) return { kind: "one", user: alike[0] };
    if (alike.length > 1) return { kind: "ambiguous", users: alike };
    return { kind: "none" };
  };

  const altas: EmployeeSyncAlta[] = [];
  const cambios: EmployeeSyncCambio[] = [];
  const porResolver: EmployeeSyncUnresolved[] = [];
  const order: EmployeeSyncOrderEntry[] = [];
  let coinciden = 0;

  // Personas ya resueltas por alguna fila: dedupe y exclusión de bajas.
  const matchedUserIds = new Set<string>();
  // Nombres ya propuestos como alta (dedupe dentro del mismo archivo).
  const altaNameKeys = new Set<string>();
  // Usernames ya ocupados (base) + los que este mismo archivo va proponiendo.
  const takenUsernames = new Set<string>(
    users.map((user) => user.username.toLowerCase())
  );

  rows.forEach((row, index) => {
    const number = parsed[index];
    const name = normalizeName(row.name);
    const departmentName = normalizeName(row.departmentName);
    const department = findByName(departments, departmentName);
    const payrollOrder = index + 1;
    // Identidad única: el número de fila se repite entre hojas ("S y S:81" y
    // "Lista de Raya:81" son renglones distintos).
    const rowKey = `${row.sheet}:${row.row}`;
    const sameDepartment = (user: SyncUserRef): boolean =>
      department !== null && user.departmentId === department.id;

    /**
     * Deja el renglón en "Por resolver" con lo necesario para resolverlo en
     * pantalla: candidatos del sistema, departamento resuelto y una propuesta
     * de alta (usuario/contraseña) por si RH decide que es una persona nueva.
     */
    const unresolved = (
      reason: EmployeeSyncUnresolvedReason,
      employeeNumber: string | null,
      detail?: string,
      candidateUsers: SyncUserRef[] = []
    ): void => {
      const proposedUsername = proposeUsername(name, takenUsernames);
      takenUsernames.add(proposedUsername);
      const parsedNumber = employeeNumber
        ? parseEmployeeNumber(employeeNumber)
        : null;
      porResolver.push({
        row: row.row,
        rowKey,
        payrollOrder,
        employeeNumber,
        name: name || null,
        departmentName: departmentName || null,
        departmentId: department?.id ?? null,
        reason,
        ...(detail !== undefined ? { detail } : {}),
        candidates: candidateUsers.map((user) => ({
          userId: user.id,
          name: user.name,
          employeeNumber: user.employeeNumber,
          departmentName: user.departmentName,
        })),
        proposedUsername,
        proposedPassword:
          parsedNumber && parsedNumber.ok
            ? proposedPassword(parsedNumber.number.value)
            : provisionalPassword(proposedUsername),
      });
    };

    /**
     * Registra que la fila resolvió a una persona: si ya estaba resuelta por
     * una fila anterior del mismo archivo, cuenta como coincidencia (dedupe) y
     * no se vuelve a listar. Siempre deja su posición de nómina la primera vez.
     */
    const recordMatch = (
      user: SyncUserRef,
      payrollOrderOfRow: number
    ): boolean => {
      if (matchedUserIds.has(user.id)) {
        coinciden += 1;
        return false;
      }
      matchedUserIds.add(user.id);
      order.push({ userId: user.id, payrollOrder: payrollOrderOfRow });
      return true;
    };

    const pushCambio = (
      user: SyncUserRef,
      employeeNumberOfRow: string | null
    ): void => {
      cambios.push({
        userId: user.id,
        row: row.row,
        rowKey,
        employeeNumber: employeeNumberOfRow,
        currentEmployeeNumber: user.employeeNumber,
        excelName: name,
        currentName: user.name,
        excelDepartmentName: department?.name ?? departmentName,
        currentDepartmentName: user.departmentName,
      });
    };

    /** Coincide si además del nombre tiene el mismo departamento; si no, es un cambio. */
    const matched = (user: SyncUserRef, payrollOrderOfRow: number): void => {
      if (!recordMatch(user, payrollOrderOfRow)) return;
      if (samePersonName(user.name, name) && sameDepartment(user)) {
        coinciden += 1;
        return;
      }
      pushCambio(user, number && number.ok ? number.number.value : null);
    };

    const proposeAlta = (
      employeeNumber: string,
      employeeNumberGenerated: boolean,
      payrollOrderOfRow: number
    ): void => {
      const nameKey = nameWords(name).sort().join(" ");
      if (nameKey && altaNameKeys.has(nameKey)) {
        coinciden += 1;
        return;
      }
      if (nameKey) altaNameKeys.add(nameKey);
      const schedule = row.scheduleName
        ? findByName(schedules, row.scheduleName)
        : null;
      const proposedUsername = proposeUsername(name, takenUsernames);
      takenUsernames.add(proposedUsername);
      altas.push({
        row: row.row,
        rowKey,
        employeeNumber,
        employeeNumberGenerated,
        name,
        departmentName: department?.name ?? departmentName,
        departmentId: department?.id ?? null,
        jobTitle: normalizeName(row.jobTitle) || null,
        payrollType: parsePayrollType(row.payrollType),
        scheduleName: row.scheduleName
          ? schedule?.name ?? normalizeName(row.scheduleName)
          : null,
        scheduleId: schedule?.id ?? null,
        scheduleWarning:
          row.scheduleName && !schedule ? SCHEDULE_NOT_FOUND_WARNING : null,
        payrollOrder: payrollOrderOfRow,
        proposedUsername,
        proposedPassword: proposedPassword(employeeNumber),
      });
    };

    // 1) Número: si viene, debe ser numérico y no repetirse dentro del archivo.
    if (number && !number.ok) {
      unresolved("INVALID_EMPLOYEE_NUMBER", normalizeName(row.employeeNumber));
      return;
    }
    if (!name) {
      unresolved("MISSING_NAME", number?.ok ? number.number.value : null);
      return;
    }
    if (number && number.ok && duplicatedNumbers.has(number.number.numeric)) {
      unresolved("DUPLICATE_EMPLOYEE_NUMBER", number.number.value);
      return;
    }

    // 2) Fila CON número: el cruce manda por número.
    if (number && number.ok) {
      const value = number.number.value;
      const existing = userForNumber(number.number.numeric, name);
      if (existing) {
        if (!existing.active) {
          unresolved("INACTIVE_USER_EXISTS", value, existing.username, [existing]);
          return;
        }
        matched(existing, payrollOrder);
        return;
      }
      // El número no existe en el sistema: si el nombre ya es de UNA persona
      // activa, es un cambio con el número del sistema (el Excel se corrige).
      const byName = resolveByName(name);
      if (byName.kind === "ambiguous") {
        unresolved(
          "NUMBER_MISMATCH",
          value,
          byName.users.map((user) => user.username).join(", "),
          byName.users
        );
        return;
      }
      if (byName.kind === "one") {
        // El número del Excel no es el del sistema: siempre es un cambio.
        if (recordMatch(byName.user, payrollOrder)) {
          pushCambio(byName.user, value);
        }
        return;
      }
      proposeAlta(value, false, payrollOrder);
      return;
    }

    // 3) Fila SIN número: se completa por nombre.
    const byName = resolveByName(name);
    if (byName.kind === "ambiguous") {
      unresolved(
        "AMBIGUOUS_NAME",
        null,
        byName.users.map((user) => user.username).join(", "),
        byName.users
      );
      return;
    }
    if (byName.kind === "one") {
      matched(byName.user, payrollOrder);
      return;
    }
    // Sin coincidencia: alta con número generado por el sistema.
    proposeAlta(generateEmployeeNumber(), true, payrollOrder);
  });

  // Bajas: activos que no están en el Excel. Solo cuentan las cuentas "de
  // nómina" (con número) o las vinculadas al reloj; nunca ADMIN, ni quien
  // ejecuta, ni nadie que alguna fila del archivo ya haya resuelto.
  const excelNumbers = new Set<number>();
  for (const result of parsed) {
    if (result && result.ok) excelNumbers.add(result.number.numeric);
  }
  const excelNames = rows
    .map((row) => nameWords(row.name))
    .filter((words) => words.length > 0);

  const bajas: EmployeeSyncBaja[] = users
    .filter((user) => {
      if (!user.active) return false;
      if (user.id === actorId) return false;
      if (user.role === "ADMIN") return false;
      if (matchedUserIds.has(user.id)) return false;
      const hasNumber = hasText(user.employeeNumber);
      if (!hasNumber && !user.linkedToClock) return false;
      const numeric = systemPayrollNumber(user.employeeNumber);
      // Un número no numérico nunca puede empatar con el Excel: cuenta como baja.
      if (numeric !== null && excelNumbers.has(numeric)) return false;
      const words = nameWords(user.name);
      if (
        words.length > 0 &&
        excelNames.some(
          (excel) => sameNameWords(words, excel) || looksAlikeWords(words, excel)
        )
      ) {
        return false;
      }
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

  return { altas, bajas, coinciden, cambios, porResolver, order };
};
