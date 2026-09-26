import { createHash } from "node:crypto";
import {
  Prisma,
  type AccessEventType,
  type AccessMethod,
  type PrismaClient,
} from "@prisma/client";
import { prismaClient } from "@core/config/database";
import { HttpError } from "@core/middlewares/error.middleware";
import type { AuditLogger } from "@modules/users/services/user.service";
import {
  ci,
  orderByOf,
  type ITDataTableFetchParams,
  type ITDataTableResponse,
} from "@core/utils/table";
import {
  localDateKey,
  localDayRange,
  parseDateFilter,
  resolveTimezoneWithConfig,
} from "@core/utils/timezone";
import type {
  AccessActor,
  AccessEventCreateInput,
  SiteCreateInput,
  SiteUpdateInput,
} from "../models/entity/access.entity";

/** Lector de `sys_config` inyectado (DIP) para la ventana anti-duplicado. */
export type SysConfigReader = (key: string) => Promise<string | null>;

/** Clave de `sys_config` que ajusta la ventana anti-duplicado (segundos). */
export const DUPLICATE_WINDOW_CONFIG_KEY = "ACCESS_DUPLICATE_WINDOW_SECONDS";

const DEFAULT_DUPLICATE_WINDOW_SECONDS = 60;

const employeeSelect = {
  id: true,
  name: true,
  employeeNumber: true,
  jobTitle: true,
  active: true,
  photoKey: true,
  department: { select: { id: true, name: true } },
} as const;

const eventInclude = {
  employee: { select: { id: true, name: true, employeeNumber: true } },
  guard: { select: { id: true, name: true } },
  site: { select: { id: true, name: true } },
} as const;

export class AccessService {
  constructor(
    private readonly db: PrismaClient = prismaClient,
    private readonly audit?: AuditLogger,
    private readonly sysConfig?: SysConfigReader
  ) {}

  // ---------------------------------------------------------------------------
  // QR / lookup
  // ---------------------------------------------------------------------------

  /**
   * Parsea el payload crudo del QR. El esquema `v:2` es JSON con `v` (versión)
   * e `id` (User.id). Cualquier otra cosa es 400; un `id` inexistente, 404.
   */
  private parseQr(qr: string): { employeeId: string; version: number; hash: string } {
    const hash = createHash("sha256").update(qr).digest("hex");
    let parsed: unknown;
    try {
      parsed = JSON.parse(qr);
    } catch {
      throw new HttpError(400, "QR_INVALID_JSON");
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new HttpError(400, "QR_INVALID_FORMAT");
    }
    const obj = parsed as Record<string, unknown>;
    const version = typeof obj.v === "number" ? obj.v : Number(obj.v);
    if (!Number.isFinite(version)) {
      throw new HttpError(400, "QR_MISSING_VERSION");
    }
    if (version !== 2) {
      throw new HttpError(400, "UNSUPPORTED_CREDENTIAL_VERSION", { version });
    }
    if (typeof obj.id !== "string" || obj.id.trim() === "") {
      throw new HttpError(400, "QR_MISSING_EMPLOYEE");
    }
    return { employeeId: obj.id, version, hash };
  }

  async lookup(qr: string) {
    const { employeeId, version } = this.parseQr(qr);
    const employee = await this.db.user.findUnique({
      where: { id: employeeId },
      select: employeeSelect,
    });
    if (!employee) {
      throw new HttpError(404, "CREDENTIAL_EMPLOYEE_NOT_FOUND");
    }
    const lastEvent = await this.lastEventFor(employee.id);
    return {
      id: employee.id,
      name: employee.name,
      employeeNumber: employee.employeeNumber,
      jobTitle: employee.jobTitle,
      department: employee.department?.name ?? null,
      active: employee.active,
      // Contrato de `fotoUrl`: ruta RELATIVA a la base de la API, sin el
      // prefijo `/api/v1`. El cliente debe resolverla contra su base
      // (web: `${BASE_URL}${fotoUrl}`; app: ruta relativa contra su ApiClient).
      // Es `null` si el empleado no tiene foto. No incluye host ni `/api/v1`.
      photoUrl: employee.photoKey ? `/hr/${employee.id}/photo/raw` : null,
      credentialVersion: version,
      lastEvent: lastEvent ? this.eventSummary(lastEvent) : null,
      suggestedType: lastEvent?.type === "ENTRY" ? ("EXIT" as const) : ("ENTRY" as const),
    };
  }

  // ---------------------------------------------------------------------------
  // Eventos
  // ---------------------------------------------------------------------------

  async createEvent(
    input: AccessEventCreateInput,
    actor: AccessActor
  ): Promise<{ event: Record<string, unknown>; created: boolean }> {
    // Capa 1 — idempotencia dura por `clientEventId`.
    const existing = await this.db.accessEvent.findUnique({
      where: { clientEventId: input.clientEventId },
      include: eventInclude,
    });
    if (existing) return { event: existing as unknown as Record<string, unknown>, created: false };

    // Resolver al empleado (QR o manual).
    let employeeId: string;
    let credentialVersion: number | null = null;
    let scannedPayloadHash: string | null = null;
    if (input.qr) {
      const parsed = this.parseQr(input.qr);
      employeeId = parsed.employeeId;
      credentialVersion = parsed.version;
      scannedPayloadHash = parsed.hash;
      if (input.employeeId && input.employeeId !== parsed.employeeId) {
        throw new HttpError(400, "EMPLOYEE_ID_MISMATCH");
      }
    } else if (input.employeeId) {
      employeeId = input.employeeId;
    } else {
      throw new HttpError(400, "QR_OR_EMPLOYEE_REQUIRED");
    }

    const employee = await this.db.user.findUnique({
      where: { id: employeeId },
      select: employeeSelect,
    });
    if (!employee) throw new HttpError(404, "EMPLOYEE_NOT_FOUND");
    if (!employee.active) {
      throw new HttpError(409, "EMPLOYEE_INACTIVE");
    }

    const site = await this.db.site.findUnique({ where: { id: input.siteId } });
    if (!site) throw new HttpError(404, "SITE_NOT_FOUND");
    if (!site.active) throw new HttpError(409, "SITE_INACTIVE");

    // Capa 2 — ventana anti-duplicado (mismo empleado + mismo tipo).
    const windowSeconds = await this.duplicateWindowSeconds();
    const duplicate = await this.db.accessEvent.findFirst({
      where: {
        employeeId,
        type: input.type,
        voidedAt: null,
        occurredAt: { gte: new Date(Date.now() - windowSeconds * 1000) },
      },
      orderBy: { occurredAt: "desc" },
      include: eventInclude,
    });
    if (duplicate) {
      throw new HttpError(409, "DUPLICATE_ACCESS_EVENT", { type: input.type, seconds: windowSeconds }, { previousEvent: duplicate });
    }

    // Capa 3 — consistencia de secuencia ENTRY/EXIT.
    const last = await this.db.accessEvent.findFirst({
      where: { employeeId, voidedAt: null },
      orderBy: { occurredAt: "desc" },
    });
    if (input.type === "ENTRY" && last?.type === "ENTRY") {
      throw new HttpError(409, "ACCESS_ENTRY_ALREADY_OPEN", {}, { previousEvent: last });
    }
    if (input.type === "EXIT" && (!last || last.type !== "ENTRY")) {
      throw new HttpError(409, "ACCESS_EXIT_WITHOUT_ENTRY", {}, { previousEvent: last ?? null });
    }

    const hasGps = input.latitude != null && input.longitude != null;
    const method = input.qr ? ("QR_SCAN" as const) : ("MANUAL" as const);
    const locationSource = hasGps ? ("GPS" as const) : ("SITE_ONLY" as const);

    let deviceTimestamp: Date | null = null;
    if (input.deviceTimestamp) {
      deviceTimestamp = new Date(input.deviceTimestamp);
      if (Number.isNaN(deviceTimestamp.getTime())) {
        throw new HttpError(400, "INVALID_DEVICE_TIMESTAMP");
      }
    }

    try {
      const event = await this.db.$transaction(async (tx) => {
        const created = await tx.accessEvent.create({
          data: {
            type: input.type,
            occurredAt: new Date(),
            deviceTimestamp,
            employeeId,
            employeeNameSnapshot: employee.name,
            employeeNumberSnapshot: employee.employeeNumber ?? null,
            guardId: actor.id,
            siteId: site.id,
            latitude: input.latitude ?? null,
            longitude: input.longitude ?? null,
            gpsAccuracyMeters: input.accuracy ?? null,
            locationSource,
            method,
            credentialVersion,
            scannedPayloadHash,
            clientEventId: input.clientEventId,
            deviceId: input.deviceId ?? null,
            deviceCode: input.deviceCode ?? null,
            notes: input.notes ?? null,
          },
          include: eventInclude,
        });

        if (this.audit) {
          await this.audit(
            {
              action: "ACCESS_EVENT_CREATED",
              entityType: "AccessEvent",
              entityId: created.id,
              userId: actor.id,
              userName: created.guard?.name ?? actor.name,
              deviceId: input.deviceId ?? undefined,
              deviceCode: input.deviceCode ?? undefined,
              newState: {
                type: created.type,
                employeeId,
                siteId: site.id,
                occurredAt: created.occurredAt.toISOString(),
              },
              metadata: {
                siteId: site.id,
                latitude: input.latitude ?? null,
                longitude: input.longitude ?? null,
              },
            },
            tx
          );
        }

        return created;
      });

      return { event: event as unknown as Record<string, unknown>, created: true };
    } catch (err) {
      // Carrera sobre `clientEventId`: devolvemos el evento existente (idempotente).
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        const raced = await this.db.accessEvent.findUnique({
          where: { clientEventId: input.clientEventId },
          include: eventInclude,
        });
        if (raced) return { event: raced as unknown as Record<string, unknown>, created: false };
      }
      throw err;
    }
  }

  async status(employeeId: string) {
    const employee = await this.db.user.findUnique({
      where: { id: employeeId },
      select: employeeSelect,
    });
    if (!employee) throw new HttpError(404, "EMPLOYEE_NOT_FOUND");
    const lastEvent = await this.lastEventFor(employeeId);
    return {
      employee: {
        id: employee.id,
        name: employee.name,
        employeeNumber: employee.employeeNumber,
        active: employee.active,
      },
      lastEvent: lastEvent ? this.eventSummary(lastEvent) : null,
      suggestedType: lastEvent?.type === "ENTRY" ? ("EXIT" as const) : ("ENTRY" as const),
      hasOpenEntry: lastEvent?.type === "ENTRY",
    };
  }

  /** Construye el `where` compartido por `table` y `stats` desde los filtros. */
  private async buildWhere(filters: ITDataTableFetchParams["filters"]): Promise<{
    base: Prisma.AccessEventWhereInput;
    includeVoided: boolean;
  }> {
    const where: Prisma.AccessEventWhereInput = {};

    if (filters.employeeId) where.employeeId = String(filters.employeeId);
    if (filters.siteId) where.siteId = String(filters.siteId);
    if (filters.type) where.type = filters.type as AccessEventType;
    if (filters.method) where.method = filters.method as AccessMethod;

    const tz = await resolveTimezoneWithConfig(
      typeof filters.tz === "string" ? filters.tz : undefined,
      this.sysConfig
    );
    const startDate = parseDateFilter(filters.start, tz, "start");
    const endDate = parseDateFilter(filters.end, tz, "end");
    if (startDate || endDate) {
      const occurredAt: Prisma.DateTimeFilter = {};
      if (startDate) occurredAt.gte = startDate;
      if (endDate) {
        // `YYYY-MM-DD` se resuelve como inicio del día siguiente (exclusivo);
        // un instante absoluto (con `T`) mantiene el `lte` retrocompatible.
        const rawEnd = typeof filters.end === "string" ? filters.end : "";
        if (rawEnd.includes("T")) occurredAt.lte = endDate;
        else occurredAt.lt = endDate;
      }
      where.occurredAt = occurredAt;
    }

    if (typeof filters.q === "string" && filters.q.trim() !== "") {
      const term = ci(filters.q);
      where.OR = [{ employeeNameSnapshot: term }, { employeeNumberSnapshot: term }];
    }

    const includeVoided = filters.includeVoided === true || filters.includeVoided === "true";
    return { base: where, includeVoided };
  }

  async table(params: ITDataTableFetchParams): Promise<ITDataTableResponse<unknown>> {
    const { base, includeVoided } = await this.buildWhere(params.filters);
    const where: Prisma.AccessEventWhereInput = includeVoided ? base : { ...base, voidedAt: null };

    const orderBy = orderByOf(
      params.sort,
      {
        occurredAt: "occurredAt",
        createdAt: "createdAt",
        type: "type",
        employeeNameSnapshot: "employeeNameSnapshot",
      },
      [{ occurredAt: "desc" }]
    );

    const [total, data] = await this.db.$transaction([
      this.db.accessEvent.count({ where }),
      this.db.accessEvent.findMany({
        where,
        include: eventInclude,
        orderBy: orderBy as Prisma.AccessEventOrderByWithRelationInput[],
        skip: (params.page - 1) * params.limit,
        take: params.limit,
      }),
    ]);

    return { data, total };
  }

  /** Conteos para los KPIs de la bitácora (respetan los mismos filtros). */
  async stats(params: ITDataTableFetchParams): Promise<{
    total: number;
    entries: number;
    exits: number;
    voided: number;
  }> {
    const { base, includeVoided } = await this.buildWhere(params.filters);
    const visible: Prisma.AccessEventWhereInput = includeVoided
      ? base
      : { ...base, voidedAt: null };

    const [total, entries, exits, voided] = await this.db.$transaction([
      this.db.accessEvent.count({ where: visible }),
      this.db.accessEvent.count({ where: { ...visible, type: "ENTRY" } }),
      this.db.accessEvent.count({ where: { ...visible, type: "EXIT" } }),
      this.db.accessEvent.count({ where: { ...base, voidedAt: { not: null } } }),
    ]);

    return { total, entries, exits, voided };
  }

  async getById(id: string) {
    const event = await this.db.accessEvent.findUnique({ where: { id }, include: eventInclude });
    if (!event) throw new HttpError(404, "ACCESS_EVENT_NOT_FOUND");
    return event;
  }

  async voidEvent(
    id: string,
    reason: string,
    actor: AccessActor
  ): Promise<{ event: Record<string, unknown>; alreadyVoided: boolean }> {
    const event = await this.db.accessEvent.findUnique({ where: { id } });
    if (!event) throw new HttpError(404, "ACCESS_EVENT_NOT_FOUND");

    if (event.voidedAt) {
      const full = await this.db.accessEvent.findUnique({ where: { id }, include: eventInclude });
      return { event: full as unknown as Record<string, unknown>, alreadyVoided: true };
    }

    const updated = await this.db.$transaction(async (tx) => {
      const row = await tx.accessEvent.update({
        where: { id },
        data: { voidedAt: new Date(), voidedById: actor.id, voidReason: reason },
        include: eventInclude,
      });

      if (this.audit) {
        await this.audit(
          {
            action: "ACCESS_EVENT_VOIDED",
            entityType: "AccessEvent",
            entityId: id,
            userId: actor.id,
            // El actor que anula puede no ser el guardia que registró el
            // evento (p. ej. un ADMIN). `userName` identifica a quien ejecuta
            // la anulación, nunca al `guard` del evento.
            userName: actor.name,
            previousState: { voidedAt: null },
            newState: { voidedAt: row.voidedAt?.toISOString(), voidReason: reason },
            metadata: { siteId: row.siteId, latitude: row.latitude, longitude: row.longitude },
          },
          tx
        );
      }

      return row;
    });

    return { event: updated as unknown as Record<string, unknown>, alreadyVoided: false };
  }

  async meToday(guardId: string, tz?: string) {
    const timezone = await resolveTimezoneWithConfig(tz, this.sysConfig);
    const { start, end } = localDayRange(localDateKey(new Date(), timezone), timezone);

    return this.db.accessEvent.findMany({
      where: { guardId, occurredAt: { gte: start, lt: end } },
      include: eventInclude,
      orderBy: { occurredAt: "desc" },
    });
  }

  // ---------------------------------------------------------------------------
  // Sitios
  // ---------------------------------------------------------------------------

  async sites(includeInactive = false) {
    return this.db.site.findMany({
      where: includeInactive ? undefined : { active: true },
      orderBy: { name: "asc" },
    });
  }

  async createSite(input: SiteCreateInput, actor: AccessActor) {
    const site = await this.db.$transaction(async (tx) => {
      const created = await tx.site.create({
        data: {
          name: input.name,
          code: input.code ?? null,
          active: input.active ?? true,
          latitude: input.latitude ?? null,
          longitude: input.longitude ?? null,
          radiusMeters: input.radiusMeters ?? null,
        },
      });

      if (this.audit) {
        await this.audit(
          {
            action: "SITE_CREATED",
            entityType: "Site",
            entityId: created.id,
            userId: actor.id,
            userName: actor.name,
            newState: { name: created.name, code: created.code, active: created.active },
          },
          tx
        );
      }

      return created;
    });

    return site;
  }

  async updateSite(id: string, input: SiteUpdateInput, actor: AccessActor) {
    const previous = await this.db.site.findUnique({ where: { id } });
    if (!previous) throw new HttpError(404, "SITE_NOT_FOUND");

    const updated = await this.db.$transaction(async (tx) => {
      const row = await tx.site.update({
        where: { id },
        data: {
          name: input.name,
          code: input.code === undefined ? undefined : input.code,
          active: input.active,
          latitude: input.latitude === undefined ? undefined : input.latitude,
          longitude: input.longitude === undefined ? undefined : input.longitude,
          radiusMeters: input.radiusMeters === undefined ? undefined : input.radiusMeters,
        },
      });

      if (this.audit) {
        await this.audit(
          {
            action: "SITE_UPDATED",
            entityType: "Site",
            entityId: id,
            userId: actor.id,
            userName: actor.name,
            previousState: {
              name: previous.name,
              code: previous.code,
              active: previous.active,
            },
            newState: { name: row.name, code: row.code, active: row.active },
          },
          tx
        );
      }

      return row;
    });

    return updated;
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private lastEventFor(employeeId: string) {
    return this.db.accessEvent.findFirst({
      where: { employeeId, voidedAt: null },
      orderBy: { occurredAt: "desc" },
      select: { id: true, type: true, occurredAt: true, voidedAt: true, siteId: true },
    });
  }

  private eventSummary(event: {
    id: string;
    type: "ENTRY" | "EXIT";
    occurredAt: Date;
    voidedAt: Date | null;
    siteId: string | null;
  }) {
    return {
      id: event.id,
      type: event.type,
      occurredAt: event.occurredAt,
      voidedAt: event.voidedAt,
      siteId: event.siteId,
    };
  }

  private async duplicateWindowSeconds(): Promise<number> {
    if (!this.sysConfig) return DEFAULT_DUPLICATE_WINDOW_SECONDS;
    const raw = await this.sysConfig(DUPLICATE_WINDOW_CONFIG_KEY);
    const parsed = raw != null ? Number(raw) : Number.NaN;
    if (Number.isFinite(parsed) && parsed >= 0) return parsed;
    return DEFAULT_DUPLICATE_WINDOW_SECONDS;
  }
}
