import { Prisma, type PrismaClient } from "@prisma/client";
import * as XLSX from "xlsx";
import { prismaClient } from "@core/config/database";
import { HttpError } from "@core/middlewares/error.middleware";
import { DEFAULT_ROLE_KEY } from "@core/permissions";
import { hashPassword } from "@core/utils/security";
import type { AuditLogger, UserService } from "./user.service";
import { readEmployeeSyncRows } from "./employee-sync-sheet";
import {
  classifyEmployeeSync,
  createEmployeeNumberGenerator,
  normalizeName,
  parseEmployeeNumber,
  systemPayrollNumber,
  type EmployeeSyncAlta,
  type EmployeeSyncBaja,
  type EmployeeSyncCambio,
  type EmployeeSyncClassification,
  type EmployeeSyncOrderEntry,
  type EmployeeSyncUnresolved,
  type SyncDepartmentRef,
  type SyncScheduleRef,
  type SyncUserRef,
} from "./employee-sync-rules";
import type { EmployeeSyncConfirmInput } from "../models/dto/employee-sync.dto";

/* -------------------------------------------------------------------------- */
/* Contrato del Excel oficial                                                  */
/* -------------------------------------------------------------------------- */

/** Columnas del reporte exportado, en español como el Excel oficial. */
const EXPORT_HEADERS = [
  "NUM_EMPLEADO",
  "NOMBRE",
  "DEPARTAMENTO",
  "SISTEMA",
  "RELOJ",
] as const;

/** Motivo e categoría de baja que registra la sincronización. */
export const EMPLOYEE_SYNC_REASON = "Sincronización nómina";
const SYNC_REMOVAL_CATEGORY = {
  key: "SYNC_PAYROLL",
  name: EMPLOYEE_SYNC_REASON,
} as const;
/** `entityId` de la bitácora: la sincronización no es una entidad con id propio. */
const SYNC_AUDIT_ENTITY_ID = "employee-sync";

const MIN_PASSWORD_LENGTH = 6;
const MIN_USERNAME_LENGTH = 3;
const MAX_TX_ATTEMPTS = 3;

/* -------------------------------------------------------------------------- */
/* Puertos (DIP)                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Operaciones de horarios que la sincronización necesita DESPUÉS del commit:
 * asignar el horario elegido a cada alta. `from` es `YYYY-MM-DD`.
 */
export interface EmployeeSyncSchedulePort {
  assignBulk(
    data: { scheduleId: string; userIds: string[]; from: string },
    actorId?: string
  ): Promise<unknown>;
  todayISO(): string;
}

/** Resultado por reloj que devuelve el padrón del checador. */
export interface EmployeeSyncClockResult {
  serial: string;
  name: string;
  ok: boolean;
  code?: string;
}

/** Operaciones del padrón del reloj (alta/baja de la persona en cada reloj). */
export interface EmployeeSyncClockPort {
  altaAll(
    userId: string,
    actorId: string
  ): Promise<{ results: EmployeeSyncClockResult[] }>;
  bajaAll(
    userId: string,
    actorId: string
  ): Promise<{ results: EmployeeSyncClockResult[] }>;
}

export interface EmployeeSyncPorts {
  schedules?: EmployeeSyncSchedulePort;
  clock?: EmployeeSyncClockPort;
}

/* -------------------------------------------------------------------------- */
/* Respuestas                                                                  */
/* -------------------------------------------------------------------------- */

/** Respuesta de `POST /users/sync/preview` (no escribe nada). */
export interface EmployeeSyncPreview {
  file: { employees: number; sheet: string };
  counts: {
    altas: number;
    bajas: number;
    coinciden: number;
    cambios: number;
    porResolver: number;
  };
  altas: EmployeeSyncAlta[];
  bajas: EmployeeSyncBaja[];
  cambios: EmployeeSyncCambio[];
  porResolver: EmployeeSyncUnresolved[];
  /** Orden de nómina (1..N) de las personas ya resueltas, sin duplicados. */
  order: EmployeeSyncOrderEntry[];
}

export interface EmployeeSyncScheduleResult {
  ok: boolean;
  error?: string;
}

/** Seguimiento de una persona en el padrón del reloj tras aplicar la sincronización. */
export interface EmployeeSyncClockRow {
  userId: string;
  name: string;
  action: "ALTA" | "BAJA";
  /** Todos los relojes contestaron bien (sin relojes, no hay nada pendiente). */
  ok: boolean;
  /** Faltó aplicar en algún reloj (o no hay permiso para escribir en el reloj). */
  pending: boolean;
  clocks: EmployeeSyncClockResult[];
  /** Solo en las altas con horario elegido en pantalla. */
  schedule?: EmployeeSyncScheduleResult;
}

/** Respuesta de `POST /users/sync/confirm`. */
export interface EmployeeSyncConfirmResult {
  system: {
    created: {
      userId: string;
      name: string;
      employeeNumber: string;
      username: string;
    }[];
    deactivated: {
      userId: string;
      name: string;
      employeeNumber: string | null;
    }[];
    updated: { userId: string; name: string }[];
  };
  clock: { enabled: boolean; results: EmployeeSyncClockRow[] };
}

/** Un renglón del reporte exportado (lo que RH revisó del archivo). */
export interface EmployeeSyncExportRow {
  employeeNumber?: string;
  name?: string;
  department?: string;
  system?: string;
  clock?: string;
}

/* -------------------------------------------------------------------------- */
/* Validación de la confirmación                                               */
/* -------------------------------------------------------------------------- */

/** Un dato por corregir: se devuelve en `details.rows` del 422. */
interface SyncRowError {
  row?: number;
  /** `hoja:fila` del renglón del Excel, para que la web pinte el error correcto. */
  rowKey?: string;
  userId?: string;
  field: string;
  code: string;
}

interface ValidatedAlta {
  row?: number;
  /** `null` = el Excel no lo traía; la transacción genera uno único. */
  employeeNumber: string | null;
  name: string;
  departmentId: string;
  jobTitle: string | null;
  username: string;
  password: string;
  scheduleId: string | null;
  /** Posición en el Excel operativo (orden de la pre-nómina). */
  payrollOrder: number | null;
}

interface ValidatedOrder {
  userId: string;
  payrollOrder: number;
}

interface ValidatedBaja {
  userId: string;
}

interface ValidatedCambio {
  userId: string;
  name?: string;
  departmentId?: string;
}

interface ValidatedConfirm {
  altas: ValidatedAlta[];
  bajas: ValidatedBaja[];
  cambios: ValidatedCambio[];
  /** Nuevo orden de nómina para personas que ya existen en el sistema. */
  order: ValidatedOrder[];
}

interface SyncContext {
  departments: SyncDepartmentRef[];
  schedules: SyncScheduleRef[];
  users: SyncUserRef[];
}

/**
 * Sincronización de empleados desde el Excel oficial de nómina.
 *
 * Dos pasos, ambos con la MISMA lectura/clasificación (`employee-sync-rules`):
 * - `preview`: no escribe nada; regresa altas (con credenciales propuestas),
 *   bajas, coincidencias, cambios informativos y renglones por resolver.
 * - `confirm`: valida TODO y aplica altas, bajas y cambios opcionales en UNA
 *   transacción Serializable; si algo falla no se aplica nada. Después del
 *   commit, y fuera de la transacción, asigna horarios y propaga el alta/baja
 *   al padrón del reloj (fallos por persona/reloj no detienen al resto).
 */
export class EmployeeSyncService {
  constructor(
    private readonly db: PrismaClient = prismaClient,
    private readonly users: UserService,
    private readonly audit?: AuditLogger,
    private readonly ports: EmployeeSyncPorts = {}
  ) {}

  /* ------------------------------ Lectura -------------------------------- */

  /** Estado del sistema que necesita la clasificación (departamentos, horarios y personas). */
  private async readContext(): Promise<SyncContext> {
    const [departments, schedules, users, links] = await Promise.all([
      this.db.department.findMany({ select: { id: true, name: true } }),
      this.db.schedule.findMany({ select: { id: true, name: true, active: true } }),
      this.db.user.findMany({
        select: {
          id: true,
          username: true,
          name: true,
          employeeNumber: true,
          active: true,
          role: true,
          departmentId: true,
          jobTitle: true,
          department: { select: { name: true } },
        },
        orderBy: { name: "asc" },
      }),
      this.db.timeClockEmployee.findMany({ select: { userId: true } }),
    ]);
    const linked = new Set(links.map((link) => link.userId));
    return {
      departments,
      // Solo los horarios activos se pueden proponer/asignar.
      schedules: schedules
        .filter((schedule) => schedule.active)
        .map(({ id, name }) => ({ id, name })),
      users: users.map((user) => ({
        id: user.id,
        username: user.username,
        name: user.name,
        employeeNumber: user.employeeNumber,
        active: user.active,
        role: user.role,
        departmentId: user.departmentId,
        departmentName: user.department?.name ?? null,
        jobTitle: user.jobTitle,
        linkedToClock: linked.has(user.id),
      })),
    };
  }

  /* ------------------------------ Preview -------------------------------- */

  /**
   * Analiza el archivo y regresa exactamente lo que haría la confirmación, sin
   * tocar la base. `actorId` se excluye de las bajas propuestas: quien ejecuta
   * la sincronización no se da de baja a sí mismo.
   */
  async preview(buffer: Buffer, actorId?: string): Promise<EmployeeSyncPreview> {
    const { sheet, rows } = readEmployeeSyncRows(buffer);
    const context = await this.readContext();
    const classification: EmployeeSyncClassification = classifyEmployeeSync({
      rows,
      users: context.users,
      departments: context.departments,
      schedules: context.schedules,
      actorId,
    });

    return {
      file: { employees: rows.length, sheet },
      counts: {
        altas: classification.altas.length,
        bajas: classification.bajas.length,
        coinciden: classification.coinciden,
        cambios: classification.cambios.length,
        porResolver: classification.porResolver.length,
      },
      altas: classification.altas,
      bajas: classification.bajas,
      cambios: classification.cambios,
      porResolver: classification.porResolver,
      order: classification.order,
    };
  }

  /* ------------------------------ Confirm -------------------------------- */

  /**
   * Confirma lo que RH revisó en el preview. Valida todo primero (si algo falla
   * responde 422 con el detalle por renglón y NO escribe nada) y después aplica
   * altas, bajas y cambios en una sola transacción Serializable.
   *
   * `options.clockEnabled` lo calcula el controlador con el permiso
   * `time_clock.write`: sin ese permiso no se escribe en el reloj y todo queda
   * `pending: true`.
   */
  async confirm(
    input: EmployeeSyncConfirmInput,
    actorId: string,
    options: { clockEnabled: boolean }
  ): Promise<EmployeeSyncConfirmResult> {
    const validated = await this.validate(input, actorId);

    // El hash es caro (bcrypt): se calcula fuera de la transacción para no
    // alargarla; si la transacción falla, los hashes simplemente se descartan.
    const hashes = await Promise.all(
      validated.altas.map((alta) => hashPassword(alta.password))
    );

    const system = await this.serializable(async (tx) => {
      const category = await tx.removalCategory.upsert({
        where: { key: SYNC_REMOVAL_CATEGORY.key },
        update: {},
        create: {
          key: SYNC_REMOVAL_CATEGORY.key,
          name: SYNC_REMOVAL_CATEGORY.name,
        },
        select: { id: true },
      });

      // Número de empleado para las altas que no lo traen: misma regla que el
      // preview (máximo de nómina de la BD + payload, secuencia, 7 dígitos).
      const existingNumbers = await tx.user.findMany({
        where: { employeeNumber: { not: null } },
        select: { employeeNumber: true },
      });
      const takenNumbers = new Set<number>();
      const takenNumberLiterals = new Set<string>();
      for (const existing of existingNumbers) {
        const raw = normalizeName(existing.employeeNumber);
        if (!raw) continue;
        takenNumberLiterals.add(raw);
        const numeric = systemPayrollNumber(raw);
        if (numeric !== null) takenNumbers.add(numeric);
      }
      for (const alta of validated.altas) {
        if (!alta.employeeNumber) continue;
        takenNumberLiterals.add(alta.employeeNumber);
        const numeric = systemPayrollNumber(alta.employeeNumber);
        if (numeric !== null) takenNumbers.add(numeric);
      }
      const generateEmployeeNumber = createEmployeeNumberGenerator({
        numbers: takenNumbers,
        literals: takenNumberLiterals,
      });

      const created: EmployeeSyncConfirmResult["system"]["created"] = [];
      for (let index = 0; index < validated.altas.length; index++) {
        const alta = validated.altas[index];
        const employeeNumber = alta.employeeNumber ?? generateEmployeeNumber();
        const row = await tx.user.create({
          data: {
            username: alta.username,
            password: hashes[index],
            name: alta.name,
            role: DEFAULT_ROLE_KEY,
            mustChangePassword: true,
            employeeNumber,
            payrollOrder: alta.payrollOrder,
            departmentId: alta.departmentId,
            jobTitle: alta.jobTitle,
          },
          select: {
            id: true,
            name: true,
            employeeNumber: true,
            username: true,
          },
        });
        created.push({
          userId: row.id,
          name: row.name,
          employeeNumber: row.employeeNumber ?? employeeNumber,
          username: row.username,
        });
      }

      // Las bajas pasan por el MISMO camino que dar de baja desde Usuarios
      // (validaciones, campos de desactivación y bitácora USER_DEACTIVATED),
      // dentro de esta misma transacción.
      const deactivated: EmployeeSyncConfirmResult["system"]["deactivated"] = [];
      for (const baja of validated.bajas) {
        const result = await this.users.deactivateInTx(tx, baja.userId, actorId, {
          reason: EMPLOYEE_SYNC_REASON,
          notifyUser: false,
          categoryId: category.id,
        });
        deactivated.push({
          userId: result.user.id,
          name: result.updated.name,
          employeeNumber: result.updated.employeeNumber,
        });
      }

      const updated: EmployeeSyncConfirmResult["system"]["updated"] = [];
      for (const cambio of validated.cambios) {
        const row = await tx.user.update({
          where: { id: cambio.userId },
          data: {
            ...(cambio.name !== undefined ? { name: cambio.name } : {}),
            ...(cambio.departmentId !== undefined
              ? { departmentId: cambio.departmentId }
              : {}),
          },
          select: { id: true, name: true },
        });
        updated.push({ userId: row.id, name: row.name });
      }

      // Orden de nómina: solo se escribe el de quien viene en el archivo; el
      // de las demás personas no se toca. Las altas ya lo llevan al crearse.
      for (const entry of validated.order) {
        await tx.user.update({
          where: { id: entry.userId },
          data: { payrollOrder: entry.payrollOrder },
          select: { id: true },
        });
      }

      await this.audit?.(
        {
          action: "USER_SYNC_APPLIED",
          entityType: "User",
          entityId: SYNC_AUDIT_ENTITY_ID,
          userId: actorId,
          newState: {
            created: created.length,
            deactivated: deactivated.length,
            updated: updated.length,
            ordered: validated.order.length,
            employeeNumbers: validated.altas.map((alta) => alta.employeeNumber),
          },
          metadata: { reason: EMPLOYEE_SYNC_REASON },
        },
        tx
      );

      return { created, deactivated, updated };
    });

    // Efectos fuera de la transacción: horario y padrón del reloj. Un fallo por
    // persona no detiene al resto (el sistema ya quedó aplicado y se reporta).
    const scheduleByUser = new Map<string, string>();
    validated.altas.forEach((alta, index) => {
      const created = system.created[index];
      if (alta.scheduleId && created) {
        scheduleByUser.set(created.userId, alta.scheduleId);
      }
    });

    const clock = await this.applyClock(
      system.created,
      system.deactivated,
      scheduleByUser,
      actorId,
      options.clockEnabled
    );

    return { system, clock };
  }

  /**
   * Propaga el resultado al padrón del reloj y asigna horarios. Se hace después
   * del commit y con best-effort: si el reloj o el horario fallan, el alta/baja
   * del sistema ya quedó y la respuesta lo dice (`pending`, `schedule.ok`).
   */
  private async applyClock(
    created: EmployeeSyncConfirmResult["system"]["created"],
    deactivated: EmployeeSyncConfirmResult["system"]["deactivated"],
    scheduleByUser: Map<string, string>,
    actorId: string,
    clockEnabled: boolean
  ): Promise<EmployeeSyncConfirmResult["clock"]> {
    const enabled = clockEnabled && Boolean(this.ports.clock);
    const results: EmployeeSyncClockRow[] = [];

    for (const user of created) {
      results.push(
        await this.clockRow(
          user.userId,
          user.name,
          "ALTA",
          scheduleByUser.get(user.userId),
          actorId,
          enabled
        )
      );
    }
    for (const user of deactivated) {
      results.push(
        await this.clockRow(user.userId, user.name, "BAJA", undefined, actorId, enabled)
      );
    }
    return { enabled, results };
  }

  /** Un alta/baja en el padrón del reloj (y el horario, solo en las altas). */
  private async clockRow(
    userId: string,
    name: string,
    action: "ALTA" | "BAJA",
    scheduleId: string | undefined,
    actorId: string,
    enabled: boolean
  ): Promise<EmployeeSyncClockRow> {
    let clocks: EmployeeSyncClockResult[] = [];
    // Sin permiso/escritura habilitada no se tocó el reloj: `ok` no puede salir
    // en true (la pantalla lo pintaría como aplicado) y queda pendiente.
    let ok = false;
    if (enabled && this.ports.clock) {
      try {
        const out =
          action === "ALTA"
            ? await this.ports.clock.altaAll(userId, actorId)
            : await this.ports.clock.bajaAll(userId, actorId);
        clocks = out.results ?? [];
        ok = clocks.every((clock) => clock.ok);
      } catch {
        // Un fallo inesperado del padrón no tumba el resto de la sincronización.
        ok = false;
      }
    }

    const row: EmployeeSyncClockRow = {
      userId,
      name,
      action,
      ok,
      pending: enabled ? !ok : true,
      clocks,
    };

    if (action === "ALTA" && scheduleId) {
      row.schedule = await this.assignSchedule(userId, scheduleId, actorId);
    }
    return row;
  }

  /** Asigna el horario elegido a un alta; reporta el error sin detener la carga. */
  private async assignSchedule(
    userId: string,
    scheduleId: string,
    actorId: string
  ): Promise<EmployeeSyncScheduleResult> {
    if (!this.ports.schedules) {
      return { ok: false, error: "SCHEDULES_UNAVAILABLE" };
    }
    try {
      await this.ports.schedules.assignBulk(
        {
          scheduleId,
          userIds: [userId],
          from: this.ports.schedules.todayISO(),
        },
        actorId
      );
      return { ok: true };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof HttpError ? err.code : "UNKNOWN",
      };
    }
  }

  /* ------------------------------ Export --------------------------------- */

  /** Reporte Excel de lo revisado (`application/vnd...spreadsheetml.sheet`). */
  export(rows: EmployeeSyncExportRow[]): Buffer {
    const sheet = XLSX.utils.aoa_to_sheet([
      [...EXPORT_HEADERS],
      ...rows.map((row) => [
        row.employeeNumber ?? "",
        row.name ?? "",
        row.department ?? "",
        row.system ?? "",
        row.clock ?? "",
      ]),
    ]);
    sheet["!cols"] = [
      { wch: 16 },
      { wch: 38 },
      { wch: 26 },
      { wch: 18 },
      { wch: 18 },
    ];
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, "Sincronización");
    return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
  }

  /* ------------------------------ Validación ----------------------------- */

  /**
   * Valida el body de confirmación completo contra el estado actual del sistema.
   * Junta TODOS los datos por corregir (no todo-o-nada por renglón): si hay al
   * menos uno, la confirmación responde 422 con el detalle y no escribe nada.
   */
  private async validate(
    input: EmployeeSyncConfirmInput,
    actorId: string
  ): Promise<ValidatedConfirm> {
    const context = await this.readContext();
    const usersById = new Map(context.users.map((user) => [user.id, user]));
    const departmentIds = new Set(context.departments.map((dept) => dept.id));
    const schedules = await this.db.schedule.findMany({
      select: { id: true, active: true },
    });
    const scheduleActiveById = new Map(
      schedules.map((schedule) => [schedule.id, schedule.active])
    );

    const takenUsernames = new Set(
      context.users.map((user) => user.username.toLowerCase())
    );
    const takenNumberValues = new Set<string>();
    const takenNumberNumerics = new Set<number>();
    for (const user of context.users) {
      const raw = normalizeName(user.employeeNumber);
      if (!raw) continue;
      takenNumberValues.add(raw);
      const numeric = systemPayrollNumber(raw);
      if (numeric !== null) takenNumberNumerics.add(numeric);
    }

    const errors: SyncRowError[] = [];
    const altas: ValidatedAlta[] = [];
    const bajas: ValidatedBaja[] = [];
    const cambios: ValidatedCambio[] = [];
    const payloadUsernames = new Set<string>();
    const payloadNumbers = new Set<number>();
    const seenBajas = new Set<string>();

    const fail = (error: SyncRowError): void => {
      errors.push(error);
    };

    /* Altas ------------------------------------------------------------------ */
    for (const alta of input.altas) {
      const row = alta.row;
      /** Error del renglón con su identidad única (si la web la mandó). */
      const failAlta = (field: string, code: string): void => {
        fail({
          ...(row !== undefined ? { row } : {}),
          ...(alta.rowKey ? { rowKey: alta.rowKey } : {}),
          field,
          code,
        });
      };
      // El número puede venir vacío: el preview propone uno generado y, si RH
      // lo deja así, la transacción genera el definitivo (misma regla).
      const number =
        alta.employeeNumber.trim() === ""
          ? null
          : parseEmployeeNumber(alta.employeeNumber);
      if (number && !number.ok) {
        failAlta("employeeNumber", number.reason);
        continue;
      }
      if (
        alta.payrollOrder !== undefined &&
        (!Number.isInteger(alta.payrollOrder) || alta.payrollOrder < 1)
      ) {
        failAlta("payrollOrder", "INVALID_PAYROLL_ORDER");
        continue;
      }
      const name = normalizeName(alta.name);
      if (!name) {
        failAlta("name", "MISSING_NAME");
        continue;
      }
      const username = alta.username.trim().toLowerCase();
      if (username.length < MIN_USERNAME_LENGTH) {
        failAlta("username", "USERNAME_MIN_LENGTH");
        continue;
      }
      if (takenUsernames.has(username) || payloadUsernames.has(username)) {
        failAlta("username", "USERNAME_TAKEN");
        continue;
      }
      if (alta.password.length < MIN_PASSWORD_LENGTH) {
        failAlta("password", "PASSWORD_MIN_LENGTH");
        continue;
      }
      if (!departmentIds.has(alta.departmentId)) {
        failAlta("departmentId", "DEPARTMENT_NOT_FOUND");
        continue;
      }
      if (alta.scheduleId && !scheduleActiveById.get(alta.scheduleId)) {
        failAlta("scheduleId", "INVALID_SCHEDULE");
        continue;
      }
      if (number) {
        const numberTaken =
          takenNumberValues.has(number.number.value) ||
          takenNumberNumerics.has(number.number.numeric);
        if (numberTaken) {
          failAlta("employeeNumber", "EMPLOYEE_NUMBER_TAKEN");
          continue;
        }
        if (payloadNumbers.has(number.number.numeric)) {
          failAlta("employeeNumber", "DUPLICATE_EMPLOYEE_NUMBER");
          continue;
        }
        payloadNumbers.add(number.number.numeric);
      }

      payloadUsernames.add(username);
      altas.push({
        row,
        employeeNumber: number ? number.number.value : null,
        name,
        departmentId: alta.departmentId,
        jobTitle: normalizeName(alta.jobTitle ?? "") || null,
        username,
        password: alta.password,
        scheduleId: alta.scheduleId ?? null,
        payrollOrder: alta.payrollOrder ?? null,
      });
    }

    /* Bajas ------------------------------------------------------------------ */
    for (const baja of input.bajas) {
      const user = usersById.get(baja.userId);
      if (!user) {
        fail({ userId: baja.userId, field: "userId", code: "USER_NOT_FOUND" });
        continue;
      }
      if (!user.active) {
        fail({ userId: user.id, field: "userId", code: "USER_ALREADY_DEACTIVATED" });
        continue;
      }
      if (user.role === "ADMIN") {
        fail({ userId: user.id, field: "userId", code: "USER_SYNC_ADMIN_PROTECTED" });
        continue;
      }
      if (user.id === actorId) {
        fail({ userId: user.id, field: "userId", code: "CANNOT_DEACTIVATE_SELF" });
        continue;
      }
      if (seenBajas.has(user.id)) {
        fail({ userId: user.id, field: "userId", code: "DUPLICATE_RECORD" });
        continue;
      }
      seenBajas.add(user.id);
      bajas.push({ userId: user.id });
    }

    /* Cambios (opcionales) --------------------------------------------------- */
    for (const cambio of input.cambios) {
      const user = usersById.get(cambio.userId);
      if (!user) {
        fail({ userId: cambio.userId, field: "userId", code: "USER_NOT_FOUND" });
        continue;
      }
      const name =
        cambio.name === undefined ? undefined : normalizeName(cambio.name);
      if (name !== undefined && !name) {
        fail({ userId: user.id, field: "name", code: "MISSING_NAME" });
        continue;
      }
      if (cambio.departmentId !== undefined && !departmentIds.has(cambio.departmentId)) {
        fail({ userId: user.id, field: "departmentId", code: "DEPARTMENT_NOT_FOUND" });
        continue;
      }
      if (name === undefined && cambio.departmentId === undefined) continue;
      cambios.push({
        userId: user.id,
        ...(name !== undefined ? { name } : {}),
        ...(cambio.departmentId !== undefined
          ? { departmentId: cambio.departmentId }
          : {}),
      });
    }

    /* Orden de nómina (opcional) --------------------------------------------- */
    const orderByUser = new Map<string, number>();
    for (const entry of input.order) {
      const user = usersById.get(entry.userId);
      if (!user) {
        fail({ userId: entry.userId, field: "userId", code: "USER_NOT_FOUND" });
        continue;
      }
      if (!Number.isInteger(entry.payrollOrder) || entry.payrollOrder < 1) {
        fail({
          userId: user.id,
          field: "payrollOrder",
          code: "INVALID_PAYROLL_ORDER",
        });
        continue;
      }
      // Si el usuario viene repetido, gana la última posición indicada.
      orderByUser.set(user.id, entry.payrollOrder);
    }
    const order: ValidatedOrder[] = [...orderByUser].map(
      ([userId, payrollOrder]) => ({ userId, payrollOrder })
    );

    if (errors.length > 0) {
      throw new HttpError(
        422,
        "USER_SYNC_INVALID_ROWS",
        { count: errors.length },
        { rows: errors }
      );
    }

    return { altas, bajas, cambios, order };
  }

  /* ------------------------------ Transacción ---------------------------- */

  /** Serializable con reintento ante choques (mismo criterio que inventario). */
  private async serializable<T>(
    fn: (tx: Prisma.TransactionClient) => Promise<T>
  ): Promise<T> {
    for (let attempt = 1; ; attempt++) {
      try {
        return await this.db.$transaction(fn, {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        });
      } catch (err) {
        const retryable =
          err instanceof Prisma.PrismaClientKnownRequestError &&
          err.code === "P2034";
        if (!retryable) throw err;
        if (attempt >= MAX_TX_ATTEMPTS) throw new HttpError(409, "CONCURRENT_UPDATE");
        await new Promise((resolve) => setTimeout(resolve, 25 * attempt));
      }
    }
  }
}
