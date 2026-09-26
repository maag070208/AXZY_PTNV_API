import { Prisma, type PrismaClient } from "@prisma/client";
import { prismaClient } from "@core/config/database";
import { HttpError } from "@core/middlewares/error.middleware";
import {
  assertDateKey,
  resolveReportRange,
  resolveTimezoneWithConfig,
} from "@core/utils/timezone";
import type { TimezoneConfigReader } from "@core/utils/timezone";
import { ci, orderByOf, type ITDataTableFetchParams } from "@core/utils/table";
import type {
  DeliveryDetailRow,
  DeliveryDetailStatus,
  DeviceAggregate,
  PeriodBucket,
  PeriodDetailResponse,
  PeriodSummaryPeriod,
  PeriodSummaryQuery,
  PeriodSummaryResponse,
  RecipientAggregate,
} from "../models/entity/report.entity";

/** Tope duro del detalle; el cliente manda menos (`detailLimit`). */
const DETAIL_LIMIT_MAX = 2000;
const DETAIL_LIMIT_DEFAULT = 500;

interface ResolvedRange {
  start: Date;
  end: Date;
  timezone: string;
}

/**
 * Filtros opcionales resueltos a `null` cuando no vienen, ya traducidos a las
 * condiciones de Prisma de cada serie.
 */
interface SeriesFilters {
  typeId: string | null;
  departmentId: string | null;
  custodianId: string | null;
}

/**
 * Quita las claves sin valor. OJO: en Prisma un `null` explícito NO es "sin
 * filtro", es `IS NULL` — un filtro ausente tiene que desaparecer del `where`,
 * no quedar en `null` (si no, el reporte cuenta sólo los préstamos sin
 * departamento y los totales no cuadran con los buckets).
 */
const compact = <T extends object>(value: T): Partial<T> =>
  Object.fromEntries(
    Object.entries(value).filter(([, v]) => v !== null && v !== undefined)
  ) as Partial<T>;

type KeyOf<T> = { [K in keyof T]: T[K] extends string | number | bigint ? K : never }[keyof T];

/** Colapsa filas `{ clave, valor }` a un total por clave. */
const sumBy = <T extends Record<string, unknown>>(
  rows: T[],
  key: KeyOf<T>,
  value: KeyOf<T>
): Map<string, number> => {
  const totals = new Map<string, number>();
  for (const row of rows) {
    const id = String(row[key]);
    const amount = Number(row[value] ?? 0);
    totals.set(id, (totals.get(id) ?? 0) + (Number.isFinite(amount) ? amount : 0));
  }
  return totals;
};

/**
 * `select` del detalle de entregas. Vive FUERA de la clase porque lo comparten
 * `detail()` (universo del PDF) y `periodDeliveries()` (página de tabla): si
 * divergieran, el PDF y la tabla mostrarían campos distintos para la misma fila.
 */
const DELIVERY_SELECT = Prisma.validator<Prisma.LoanItemSelect>()({
  id: true,
  quantity: true,
  returnedQuantity: true,
  device: {
    select: { id: true, name: true, brand: true, model: true, type: { select: { id: true, name: true } } },
  },
  loan: {
    select: {
      id: true,
      number: true,
      date: true,
      custodian: { select: { name: true, employeeNumber: true } },
      department: { select: { name: true } },
      subarea: { select: { name: true } },
      movement: { select: { createdBy: { select: { name: true } } } },
      returns: {
        orderBy: { date: "asc" },
        select: { number: true, date: true, items: { select: { loanItemId: true } } },
      },
    },
  },
});

/** Fila cruda de `LoanItem` con el `select` de arriba. */
type DeliverySelectRow = Prisma.LoanItemGetPayload<{ select: typeof DELIVERY_SELECT }>;

/**
 * Allowlist de orden de la tabla de entregas. Sólo columnas y relaciones a-uno
 * de `LoanItem`. `status` NO aparece: es un valor DERIVADO (la comparación entre
 * `returnedQuantity` y `quantity` de la misma fila) y no una columna, así que
 * ordenarlo no es una operación que Prisma pueda expresar.
 */
type OrderByMap = Record<string, string | ((direction: "asc" | "desc") => unknown)>;

const DELIVERIES_ORDER_BY: OrderByMap = {
  date: (direction) => ({ loan: { date: direction } }),
  number: (direction) => ({ loan: { number: direction } }),
  custodianName: (direction) => ({ loan: { custodian: { name: direction } } }),
  departmentName: (direction) => ({ loan: { department: { name: direction } } }),
  description: (direction) => ({ device: { name: direction } }),
  typeName: (direction) => ({ device: { type: { name: direction } } }),
  quantity: "quantity",
  returnedQuantity: "returnedQuantity",
};

/** Orden estable: lo más reciente primero, desempatado por id. */
const DELIVERIES_FALLBACK_ORDER_BY: Prisma.LoanItemOrderByWithRelationInput[] = [
  { loan: { date: "desc" } },
  { id: "asc" },
];

/** Lee un filtro de tabla como string no vacío. */
const str = (value: unknown): string | undefined =>
  typeof value === "string" && value !== "" ? value : undefined;

/**
 * Reporte de periodo del inventario: **tres series, cada una de su tabla
 * autoritativa**, para no duplicar el mismo evento.
 *
 * - `delivered` ← `Loan`/`LoanItem`. Crear un préstamo TAMBIÉN emite un
 *   `Movement` de tipo `LOAN` (`Loan.movementId` es único): contar los dos
 *   duplicaría la entrega. Por eso el movimiento de préstamo NO se usa aquí.
 * - `returned` ← `LoanReturn`/`LoanReturnItem`. Las devoluciones también emiten
 *   un `Movement`, pero la fuente con fecha y folio es `LoanReturn`.
 * - `admitted` ← `Movement` con `type IN (STOCK_IN, ADJUSTMENT_IN)` y
 *   `status = ACTIVE`. Fuera de alcance: `RETIREMENT`, `ADJUSTMENT_OUT`,
 *   `MAINTENANCE_*`, `TRANSFER` y los `CANCELLED`.
 *
 * `net` es el **delta de responsabilidad** (entregados − devueltos *del
 * periodo*), no un neto de inventario: la devolución de un préstamo de otro
 * periodo lo baja a propósito.
 *
 * Toda agregación ocurre en Postgres (`aggregate` / `groupBy`). El único
 * agregado que Prisma no expresa sobre un `DateTime` es el bucket diario por
 * zona horaria, y vive aislado en `dailyBuckets()`.
 */
export class PeriodSummaryService {
  constructor(
    private readonly db: PrismaClient = prismaClient,
    private readonly sysConfig?: TimezoneConfigReader
  ) {}

  // ---------------------------------------------------------------------------
  // Resumen
  // ---------------------------------------------------------------------------

  async summary(query: PeriodSummaryQuery): Promise<PeriodSummaryResponse> {
    const range = await this.resolveRange(query);
    const filters = this.readFilters(query);

    // Cada serie trae su propio juego de `where`; los filtros viajan DENTRO de
    // la consulta, nunca se recortan en JS.
    const delivered = this.deliveredWhere(range, filters);
    const returned = this.returnedWhere(range, filters);
    const admitted = this.admittedWhere(range, filters);

    const [deliveredTotal, returnedTotal, admittedTotal, loanByItems, returnByItems, movementByItems] =
      await Promise.all([
        this.db.loanItem.aggregate({ where: delivered, _sum: { quantity: true } }),
        this.db.loanReturnItem.aggregate({ where: returned, _sum: { quantity: true } }),
        this.db.movementItem.aggregate({ where: admitted, _sum: { quantity: true } }),
        this.db.loanItem.groupBy({ by: ["loanId", "deviceId"], where: delivered, _sum: { quantity: true } }),
        this.db.loanReturnItem.groupBy({ by: ["loanReturnId", "deviceId"], where: returned, _sum: { quantity: true } }),
        this.db.movementItem.groupBy({ by: ["movementId", "deviceId"], where: admitted, _sum: { quantity: true } }),
      ]);

    const byDevice = await this.byDevice(
      loanByItems.map((g) => ({ deviceId: g.deviceId, delivered: g._sum.quantity ?? 0 })),
      returnByItems.map((g) => ({ deviceId: g.deviceId, returned: g._sum.quantity ?? 0 })),
      movementByItems.map((g) => ({ deviceId: g.deviceId, admitted: g._sum.quantity ?? 0 }))
    );

    const recipients = await this.recipients(
      loanByItems.map((g) => ({ loanId: g.loanId, delivered: g._sum.quantity ?? 0 })),
      returnByItems.map((g) => ({ loanReturnId: g.loanReturnId, returned: g._sum.quantity ?? 0 }))
    );

    const byPeriod = await this.dailyBuckets(range, filters);

    const deliveredCount = deliveredTotal._sum.quantity ?? 0;
    const returnedCount = returnedTotal._sum.quantity ?? 0;
    const admittedCount = admittedTotal._sum.quantity ?? 0;

    // `groupBy` agrupa por (documento, dispositivo): un préstamo con tres
    // tipos de equipo es un solo documento, así que los "distintos" se cuentan
    // sobre el conjunto de documentos, no sobre las filas del agregado.
    const distinctLoans = new Set(loanByItems.map((g) => g.loanId)).size;
    const distinctReturns = new Set(returnByItems.map((g) => g.loanReturnId)).size;
    const distinctMovements = new Set(movementByItems.map((g) => g.movementId)).size;

    return {
      range: {
        start: range.start.toISOString(),
        end: range.end.toISOString(),
        timezone: range.timezone,
        period: query.period,
        date: query.date,
      },
      filters: {
        typeId: filters.typeId,
        departmentId: filters.departmentId,
        custodianId: filters.custodianId,
      },
      totals: {
        delivered: deliveredCount,
        returned: returnedCount,
        admitted: admittedCount,
        net: deliveredCount - returnedCount,
        distinctRecipients: recipients.length,
        distinctDevices: byDevice.length,
        distinctLoans,
        distinctReturns,
        distinctMovements,
      },
      byPeriod,
      byDevice,
      recipients,
    };
  }

  // ---------------------------------------------------------------------------
  // Detalle de entregas
  // ---------------------------------------------------------------------------

  /**
   * Una fila por ÍTEM de préstamo del periodo (`LoanItem.quantity` una sola vez,
   * aunque el ítem tenga varias unidades físicas), ordenada por fecha de entrega
   * descendente. `returnDate`/`returnNumber` salen de `LoanReturn` real.
   */
  async detail(query: PeriodSummaryQuery, detailLimit?: number): Promise<PeriodDetailResponse> {
    const range = await this.resolveRange(query);
    const filters = this.readFilters(query);
    const limit = this.readDetailLimit(detailLimit ?? query.detailLimit);

    const where = this.deliveredWhere(range, filters);

    const [loans, total] = await Promise.all([
      this.db.loanItem.findMany({
        where,
        // +1 fila para saber si hubo truncamiento sin un segundo conteo.
        take: limit + 1,
        orderBy: DELIVERIES_FALLBACK_ORDER_BY,
        select: DELIVERY_SELECT,
      }),
      this.db.loanItem.count({ where }),
    ]);

    const truncated = loans.length > limit;
    const data: DeliveryDetailRow[] = loans
      .slice(0, limit)
      .map((item) => this.mapDeliveryRow(item, this.findReturnOf(item)));

    return { data, total, truncated };
  }

  // ---------------------------------------------------------------------------
  // Detalle de entregas — tabla server-side
  // ---------------------------------------------------------------------------

  /**
   * Página del detalle de entregas del periodo, con los MISMOS filtros de
   * `summary()` más los propios de la tabla (`q` y `status`). El detalle puede
   * llegar a miles de filas: traer el universo y paginar en el cliente está
   * prohibido, así que el corte y el orden se resuelven en Postgres.
   */
  async periodDeliveries(
    params: ITDataTableFetchParams
  ): Promise<{ data: DeliveryDetailRow[]; total: number }> {
    const query = this.readPeriodQuery(params.filters);
    const range = await this.resolveRange(query);
    const where = this.deliveriesWhere(
      this.deliveredWhere(range, this.readFilters(query)),
      params.filters
    );
    const orderBy = orderByOf(params.sort, DELIVERIES_ORDER_BY, DELIVERIES_FALLBACK_ORDER_BY);

    const [rows, total] = await Promise.all([
      this.db.loanItem.findMany({
        where: where as never,
        orderBy: orderBy as never,
        skip: (params.page - 1) * params.limit,
        take: params.limit,
        select: DELIVERY_SELECT,
      }),
      this.db.loanItem.count({ where: where as never }),
    ]);

    return {
      data: rows.map((item) => this.mapDeliveryRow(item, this.findReturnOf(item))),
      total,
    };
  }

  /** La devolución REAL del ítem: la primera `LoanReturn` que lo contiene. */
  private findReturnOf(item: DeliverySelectRow) {
    return item.loan.returns.find((r) => r.items.some((i) => i.loanItemId === item.id));
  }

  /**
   * Mapea un ítem de préstamo a la fila del reporte. Vive aquí para que el
   * universo del PDF y la página de la tabla produzcan EXACTAMENTE la misma fila
   * (mismo `select`, mismo `status` derivado, misma fecha de devolución real).
   */
  private mapDeliveryRow(
    item: DeliverySelectRow,
    returned: DeliverySelectRow["loan"]["returns"][number] | undefined
  ): DeliveryDetailRow {
    const loan = item.loan;
    const status: DeliveryDetailStatus =
      item.returnedQuantity >= item.quantity && item.returnedQuantity > 0
        ? "RETURNED"
        : item.returnedQuantity > 0
          ? "PARTIAL"
          : "ACTIVE";

    return {
      id: item.id,
      date: loan.date.toISOString(),
      number: loan.number,
      custodianName: loan.custodian?.name ?? "",
      employeeNumber: loan.custodian?.employeeNumber ?? null,
      departmentName: loan.department?.name ?? null,
      subareaName: loan.subarea?.name ?? null,
      deliveredBy: loan.movement?.createdBy.name ?? "",
      deviceId: item.device.id,
      description: item.device.name,
      typeName: item.device.type.name,
      brand: item.device.brand,
      model: item.device.model,
      quantity: item.quantity,
      returnedQuantity: item.returnedQuantity,
      returnDate: returned ? returned.date.toISOString() : null,
      returnNumber: returned ? returned.number : null,
      status,
    };
  }

  // ---------------------------------------------------------------------------
  // Rango y filtros
  // ---------------------------------------------------------------------------

  /**
   * `[start, end)` en la zona oficial. El borde del día lo calcula
   * `resolveReportRange` (nunca `new Date(end + "T23:59:59")`, que depende del
   * reloj del proceso). Un `date` o un `timezone` inválidos son 400.
   */
  private async resolveRange(query: PeriodSummaryQuery): Promise<ResolvedRange> {
    if (query.period !== "DAY" && query.period !== "WEEK" && query.period !== "MONTH") {
      throw new HttpError(400, "INVALID_REPORT_PERIOD");
    }
    const dateKey = assertDateKey(query.date, "INVALID_REPORT_DATE");
    const timezone = await resolveTimezoneWithConfig(query.timezone, this.sysConfig);
    const { start, end } = resolveReportRange(query.period, dateKey, timezone);
    return { start, end, timezone };
  }

  private readFilters(query: PeriodSummaryQuery): SeriesFilters {
    return {
      typeId: query.typeId || null,
      departmentId: query.departmentId || null,
      custodianId: query.custodianId || null,
    };
  }

  /**
   * El cuerpo de una tabla de detalle no usa el DTO de `period-summary`: los
   * filtros del periodo viajan dentro de `filters` (el contrato de `ITDataTable`).
   * Aquí se leen y se validan con las MISMAS reglas que `resolveRange`, de modo
   * que la tabla y el resumen no puedan discrepar sobre qué ventana es "el día".
   */
  private readPeriodQuery(
    filters: Record<string, string | number | boolean>
  ): PeriodSummaryQuery {
    return {
      period: (str(filters.period) ?? "DAY") as PeriodSummaryPeriod,
      date: str(filters.date) ?? "",
      timezone: str(filters.timezone),
      typeId: str(filters.typeId),
      departmentId: str(filters.departmentId),
      custodianId: str(filters.custodianId),
    };
  }

  /**
   * Filtros PROPIOS de la tabla, encima del `where` de la serie de entregas:
   *
   * - `q` busca por folio, descripción de equipo o nombre del custodio, que es lo
   *   que el usuario tiene a la vista en esas tres columnas.
   * - `status` es el único filtro derivado: se traduce a la comparación entre
   *   `returnedQuantity` y el `quantity` de la misma fila, que es exactamente
   *   el criterio de `mapDeliveryRow`. Por eso no es ordenable.
   *
   * OJO (misma razón que `compact`): un filtro vacío NO viaja, y jamás como
   * `null` — en Prisma eso sería `IS NULL`.
   */
  private deliveriesWhere(
    base: Record<string, unknown>,
    filters: Record<string, string | number | boolean>
  ): Record<string, unknown> {
    const q = str(filters.q);
    const statusWhere = this.statusWhere(str(filters.status));
    return compact({
      ...base,
      ...(q
        ? {
            OR: [
              { loan: { number: ci(q) } },
              { device: { name: ci(q) } },
              { loan: { custodian: { name: ci(q) } } },
            ],
          }
        : {}),
      ...(statusWhere ?? {}),
    }) as Record<string, unknown>;
  }

  /**
   * `status` es derivado, no una columna: se expresa comparando `returnedQuantity`
   * contra el `quantity` de la misma fila (referencia de campo de Prisma), que
   * es el mismo criterio que usa el mapper del detalle.
   */
  private statusWhere(status: string | undefined): Record<string, unknown> | null {
    const quantity = this.db.loanItem.fields.quantity;
    switch (status) {
      case "ACTIVE":
        return { returnedQuantity: 0 };
      case "RETURNED":
        return { returnedQuantity: { gt: 0, gte: quantity } };
      case "PARTIAL":
        return { returnedQuantity: { gt: 0, lt: quantity } };
      default:
        return null;
    }
  }

  /**
   * El DTO (`PeriodSummaryQuerySchema`) valida `detailLimit` en 1..2000 y es la
   * única frontera con el cliente; aquí solo se acota para que un llamador
   * interno no pueda pedir el universo completo.
   */
  private readDetailLimit(value: number | undefined): number {
    if (value === undefined) return DETAIL_LIMIT_DEFAULT;
    if (!Number.isInteger(value)) return DETAIL_LIMIT_DEFAULT;
    return Math.min(Math.max(value, 1), DETAIL_LIMIT_MAX);
  }

  // ---------------------------------------------------------------------------
  // `where` por serie
  // ---------------------------------------------------------------------------

  /** Entregas: `Loan` no cancelado dentro de la ventana. */
  private deliveredWhere(range: ResolvedRange, filters: SeriesFilters): Record<string, unknown> {
    return compact({
      loan: compact({
        date: { gte: range.start, lt: range.end },
        status: { not: "CANCELLED" },
        departmentId: filters.departmentId,
        custodianId: filters.custodianId,
      }),
      device: filters.typeId ? { typeId: filters.typeId } : undefined,
    }) as Record<string, unknown>;
  }

  /**
   * Devoluciones: `LoanReturn` dentro de la ventana, sobre préstamo no cancelado.
   * El custodio se puede haber capturado en la devolución o sólo en el
   * préstamo, así que el filtro de persona acepta cualquiera de los dos (igual
   * que el SQL de los buckets).
   */
  private returnedWhere(range: ResolvedRange, filters: SeriesFilters): Record<string, unknown> {
    return compact({
      loanReturn: compact({
        date: { gte: range.start, lt: range.end },
        custodianId: filters.custodianId,
        loan: compact({
          status: { not: "CANCELLED" },
          departmentId: filters.departmentId,
          custodianId: filters.custodianId,
        }),
      }),
      device: filters.typeId ? { typeId: filters.typeId } : undefined,
    }) as Record<string, unknown>;
  }

  /** Incorporaciones: `STOCK_IN`/`ADJUSTMENT_IN` activos dentro de la ventana. */
  private admittedWhere(range: ResolvedRange, filters: SeriesFilters): Record<string, unknown> {
    return compact({
      movement: compact({
        date: { gte: range.start, lt: range.end },
        type: { in: ["STOCK_IN", "ADJUSTMENT_IN"] },
        status: "ACTIVE",
        departmentId: filters.departmentId,
        custodianId: filters.custodianId,
      }),
      device: filters.typeId ? { typeId: filters.typeId } : undefined,
    }) as Record<string, unknown>;
  }

  // ---------------------------------------------------------------------------
  // Agregados
  // ---------------------------------------------------------------------------

  /**
   * Une las tres series por `deviceId` y resuelve nombre/tipo con UNA consulta
   * acotada a los ids presentes (no se materializa el catálogo de dispositivos).
   */
  private async byDevice(
    delivered: Array<{ deviceId: string; delivered: number }>,
    returned: Array<{ deviceId: string; returned: number }>,
    admitted: Array<{ deviceId: string; admitted: number }>
  ): Promise<DeviceAggregate[]> {
    const merged = new Map<string, { delivered: number; returned: number; admitted: number }>();
    // El `groupBy` de arriba es por (documento, dispositivo): un mismo equipo
    // puede aparecer en varias entregas del periodo, así que las tres ramas
    // ACUMULAN. Sobrescribir (`set` con el último) perdería unidades y el
    // agregado no cuadraría con `totals`.
    const add = (deviceId: string, field: "delivered" | "returned" | "admitted", value: number) => {
      const entry = merged.get(deviceId) ?? { delivered: 0, returned: 0, admitted: 0 };
      entry[field] += value;
      merged.set(deviceId, entry);
    };
    for (const row of delivered) add(row.deviceId, "delivered", row.delivered);
    for (const row of returned) add(row.deviceId, "returned", row.returned);
    for (const row of admitted) add(row.deviceId, "admitted", row.admitted);

    const ids = [...merged.keys()];
    if (ids.length === 0) return [];

    const devices = await this.db.device.findMany({
      where: { id: { in: ids } },
      select: { id: true, name: true, typeId: true, type: { select: { name: true } } },
    });
    const catalog = new Map(devices.map((d) => [d.id, d]));

    return ids
      .map((id) => {
        const device = catalog.get(id);
        const counts = merged.get(id) ?? { delivered: 0, returned: 0, admitted: 0 };
        return {
          deviceId: id,
          description: device?.name ?? "",
          typeId: device?.typeId ?? "",
          typeName: device?.type.name ?? "",
          delivered: counts.delivered,
          returned: counts.returned,
          admitted: counts.admitted,
          net: counts.delivered - counts.returned,
        };
      })
      .sort((a, b) => b.delivered - a.delivered || a.description.localeCompare(b.description));
  }

  /**
   * Destinatarios del periodo. El cruce es sobre conjuntos ACOTADOS (préstamos
   * y devoluciones del periodo, no el universo), y se dobla en memoria como
   * documenta `AccessReportService`: hace falta unir persona, departamento y
   * dos series por persona, que ningún agregado de Prisma expresa.
   *
   * `outstanding` es lo que esa persona conserva de lo que recibió en este
   * periodo, acotado en 0: devolver más de lo entregado significa que también
   * devolvió algo de un préstamo anterior, y eso no es un "pendiente" negativo.
   */
  private async recipients(
    loans: Array<{ loanId: string; delivered: number }>,
    returns: Array<{ loanReturnId: string; returned: number }>
  ): Promise<RecipientAggregate[]> {
    // El `groupBy` de arriba viene por (documento, dispositivo): primero se
    // colapsa a un total por documento, o un préstamo con varios tipos de
    // equipo se contaría como varios préstamos y varias entregas.
    const deliveredByLoan = sumBy(loans, "loanId", "delivered");
    const returnedByReturn = sumBy(returns, "loanReturnId", "returned");

    const loanRows = deliveredByLoan.size
      ? await this.db.loan.findMany({
          where: { id: { in: [...deliveredByLoan.keys()] }, status: { not: "CANCELLED" } },
          select: { id: true, custodianId: true },
        })
      : [];
    const custodianOfLoan = new Map(loanRows.map((l) => [l.id, l.custodianId]));

    const returnRows = returnedByReturn.size
      ? await this.db.loanReturn.findMany({
          where: { id: { in: [...returnedByReturn.keys()] } },
          select: { id: true, custodianId: true, loan: { select: { custodianId: true } } },
        })
      : [];
    const custodianOfReturn = new Map(
      returnRows.map((r) => [r.id, r.custodianId ?? r.loan.custodianId])
    );

    const userIds = new Set<string>();
    for (const loanId of deliveredByLoan.keys()) {
      const custodianId = custodianOfLoan.get(loanId);
      if (custodianId) userIds.add(custodianId);
    }
    for (const returnId of returnedByReturn.keys()) {
      const custodianId = custodianOfReturn.get(returnId);
      if (custodianId) userIds.add(custodianId);
    }
    if (userIds.size === 0) return [];

    const users = await this.db.user.findMany({
      where: { id: { in: [...userIds] } },
      select: {
        id: true,
        name: true,
        employeeNumber: true,
        department: { select: { name: true } },
      },
      orderBy: { name: "asc" },
    });

    const loansPerUser = new Map<string, { count: number; delivered: number }>();
    for (const [loanId, delivered] of deliveredByLoan) {
      const userId = custodianOfLoan.get(loanId);
      if (!userId) continue;
      const entry = loansPerUser.get(userId) ?? { count: 0, delivered: 0 };
      entry.count += 1;
      entry.delivered += delivered;
      loansPerUser.set(userId, entry);
    }

    const returnedPerUser = new Map<string, number>();
    for (const [returnId, returned] of returnedByReturn) {
      const userId = custodianOfReturn.get(returnId);
      if (!userId) continue;
      returnedPerUser.set(userId, (returnedPerUser.get(userId) ?? 0) + returned);
    }

    return users.map((user) => {
      const loansOfUser = loansPerUser.get(user.id) ?? { count: 0, delivered: 0 };
      const returned = returnedPerUser.get(user.id) ?? 0;
      return {
        userId: user.id,
        name: user.name,
        employeeNumber: user.employeeNumber,
        departmentName: user.department?.name ?? null,
        loans: loansOfUser.count,
        delivered: loansOfUser.delivered,
        returned,
        outstanding: Math.max(0, loansOfUser.delivered - returned),
      };
    });
  }

  // ---------------------------------------------------------------------------
  // Bucket diario (único $queryRaw del módulo)
  // ---------------------------------------------------------------------------

  /**
   * POR QUÉ EXISTE: el bucket diario necesita el día LOCAL de un `DateTime`, y
   * el `groupBy` de Prisma no puede agrupar un `DateTime` truncado por zona (sólo
   * por campo exacto). Es el único `$queryRaw` del módulo y está aislado aquí a
   * propósito.
   *
   * CONVERSIÓN DE ZONA (el punto delicado): las columnas son `timestamp without
   * time zone` y Prisma las guarda con la pared de **UTC**. La cadena
   * `(col AT TIME ZONE 'UTC') AT TIME ZONE $tz` lee el valor como instante UTC y
   * lo devuelve como pared en `$tz`; el `AT TIME ZONE $tz` a secas haría lo
   * contrario (interpretaba la pared UTC como si fuera local) y desplazaría cada
   * evento unas horas. El rango de las otras consultas usa la misma `tz`, así que
   * `range.timezone` y los buckets no pueden divergir.
   *
   * CÓMO SE SEGURO: plantilla etiquetada `Prisma.sql`, sin interpolación de
   * strings — los valores viajan como parámetros de Postgres. Los nombres de
   * tabla salen de los `@@map` del schema (`loans`, `loan_items`,
   * `loan_returns`, `loan_return_items`, `movements`, `movement_items`); si una
   * migración los renombra, este SQL se ve en el diff.
   *
   * El día sale como TEXTO (`to_char`) a propósito: Postgres devuelve `date`
   * como un `Date` en hora local del proceso y la clave `YYYY-MM-DD` se
   * deformaría.
   */
  private async dailyBuckets(
    range: ResolvedRange,
    filters: SeriesFilters
  ): Promise<PeriodBucket[]> {
    const tz = range.timezone;
    const start = range.start;
    const end = range.end;
    const { typeId, departmentId, custodianId } = filters;

    // Un filtro de tipo se resuelve sobre el dispositivo del ítem (mismo
    // `deviceId` en las tres series). Cada rama escribe su propia cláusula con
    // la columna YA dentro de la plantilla: no hay `Prisma.raw` ni texto armado
    // a mano, solo literales del código y valores como parámetros.
    const rows = await this.db.$queryRaw<
      Array<{ day: string; delivered: bigint | number; returned: bigint | number; admitted: bigint | number }>
    >(Prisma.sql`
      SELECT
        -- La columna "day" ya viene como texto YYYY-MM-DD de las tres ramas:
        -- aquí sólo se rellena la que falte (FULL OUTER JOIN deja nulos).
        COALESCE(d.day, r.day, a.day) AS "day",
        COALESCE(d.delivered, 0)::bigint AS "delivered",
        COALESCE(r.returned, 0)::bigint AS "returned",
        COALESCE(a.admitted, 0)::bigint AS "admitted"
      FROM (
        SELECT to_char((l."date" AT TIME ZONE 'UTC') AT TIME ZONE ${tz}, 'YYYY-MM-DD') AS day,
               SUM(li."quantity") AS delivered
        FROM "loan_items" li
        JOIN "loans" l ON l."id" = li."loanId"
        WHERE l."date" >= ${start} AND l."date" < ${end}
          AND l."status" <> 'CANCELLED'
          ${departmentId ? Prisma.sql`AND l."departmentId" = ${departmentId}` : Prisma.empty}
          ${custodianId ? Prisma.sql`AND l."custodianId" = ${custodianId}` : Prisma.empty}
          ${typeId
            ? Prisma.sql`AND li."deviceId" IN (SELECT "id" FROM "devices" WHERE "typeId" = ${typeId})`
            : Prisma.empty}
        GROUP BY 1
      ) d
      FULL OUTER JOIN (
        SELECT to_char((lr."date" AT TIME ZONE 'UTC') AT TIME ZONE ${tz}, 'YYYY-MM-DD') AS day,
               SUM(lri."quantity") AS returned
        FROM "loan_return_items" lri
        JOIN "loan_returns" lr ON lr."id" = lri."loanReturnId"
        JOIN "loans" l ON l."id" = lr."loanId"
        WHERE lr."date" >= ${start} AND lr."date" < ${end}
          AND l."status" <> 'CANCELLED'
          ${departmentId ? Prisma.sql`AND l."departmentId" = ${departmentId}` : Prisma.empty}
          ${custodianId
            ? Prisma.sql`AND (lr."custodianId" = ${custodianId} OR l."custodianId" = ${custodianId})`
            : Prisma.empty}
          ${typeId
            ? Prisma.sql`AND lri."deviceId" IN (SELECT "id" FROM "devices" WHERE "typeId" = ${typeId})`
            : Prisma.empty}
        GROUP BY 1
      ) r ON r.day = d.day
      FULL OUTER JOIN (
        SELECT to_char((m."date" AT TIME ZONE 'UTC') AT TIME ZONE ${tz}, 'YYYY-MM-DD') AS day,
               SUM(mi."quantity") AS admitted
        FROM "movement_items" mi
        JOIN "movements" m ON m."id" = mi."movementId"
        WHERE m."date" >= ${start} AND m."date" < ${end}
          AND m."type" IN ('STOCK_IN','ADJUSTMENT_IN')
          AND m."status" = 'ACTIVE'
          ${departmentId ? Prisma.sql`AND m."departmentId" = ${departmentId}` : Prisma.empty}
          ${custodianId ? Prisma.sql`AND m."custodianId" = ${custodianId}` : Prisma.empty}
          ${typeId
            ? Prisma.sql`AND mi."deviceId" IN (SELECT "id" FROM "devices" WHERE "typeId" = ${typeId})`
            : Prisma.empty}
        GROUP BY 1
      ) a ON a.day = COALESCE(d.day, r.day)
      ORDER BY 1
    `);

    return rows.map((row) => {
      const delivered = Number(row.delivered);
      const returned = Number(row.returned);
      const admitted = Number(row.admitted);
      return { day: row.day, delivered, returned, admitted, net: delivered - returned };
    });
  }
}

/** Reexportado para que el controlador no duplique el tope. */
export { DETAIL_LIMIT_MAX };
