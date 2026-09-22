import type { PrismaClient } from "@prisma/client";
import { prismaClient } from "@core/config/database";
import { HttpError } from "@core/middlewares/error.middleware";
import type { AuditLogger } from "@modules/users/services/user.service";
import { assertSysConfigKey } from "../models/dto/sys-config.dto";
import type { SysConfigRecord } from "../models/entity/sys-config.entity";

const CACHE_TTL_MS = 60_000;

const sysConfigSelect = {
  id: true,
  key: true,
  value: true,
  descripcion: true,
  updatedAt: true,
  updatedById: true,
  updatedBy: { select: { id: true, name: true } },
} as const;

/**
 * Servicio de configuración del sistema (tabla `sys_config`).
 *
 * Expone un cache en memoria con TTL de 60s para evitar pegarle a la BD
 * cada vez que se envía un email. `upsert`/`remove` invalidan la(s)
 * entrada(s) correspondiente(s); las llamadas posteriores rehidratan.
 *
 * Auditoría: cada `upsert`/`remove` registra en `audit_logs` envuelto en
 * la misma `$transaction` que el cambio, siguiendo el patrón de
 * `user.service.ts#deactivate` (ver ahí el razonamiento).
 */
export class SysConfigService {
  private readonly cache = new Map<string, { value: string; ts: number }>();

  constructor(
    private readonly db: PrismaClient = prismaClient,
    private readonly audit?: AuditLogger
  ) {}

  invalidate(key?: string) {
    if (key) {
      this.cache.delete(key);
    } else {
      this.cache.clear();
    }
  }

  private cacheGet(key: string): string | null {
    const hit = this.cache.get(key);
    if (!hit) return null;
    if (Date.now() - hit.ts > CACHE_TTL_MS) {
      this.cache.delete(key);
      return null;
    }
    return hit.value;
  }

  private cacheSet(key: string, value: string) {
    this.cache.set(key, { value, ts: Date.now() });
  }

  async list(): Promise<SysConfigRecord[]> {
    return this.db.sysConfig.findMany({
      orderBy: { key: "asc" },
      select: sysConfigSelect,
    });
  }

  /**
   * Lectura por clave. Usa cache TTL=60s. Devuelve `null` si no existe
   * (NO lanza 404 — los callers (mail.ts) prefieren un fallback a env).
   */
  async get(key: string): Promise<SysConfigRecord | null> {
    assertSysConfigKey(key);
    const cached = this.cacheGet(key);
    if (cached !== null) {
      return {
        id: "cached",
        key,
        value: cached,
        descripcion: null,
        updatedAt: new Date(),
        updatedById: null,
        updatedBy: null,
      };
    }
    const row = await this.db.sysConfig.findUnique({
      where: { key },
      select: sysConfigSelect,
    });
    if (!row) return null;
    this.cacheSet(key, row.value);
    return row;
  }

  async upsert(
    key: string,
    value: string,
    descripcion: string | undefined,
    actorId: string
  ): Promise<SysConfigRecord> {
    assertSysConfigKey(key);
    const previous = await this.db.sysConfig.findUnique({
      where: { key },
      select: { value: true, descripcion: true },
    });

    const updated = await this.db.$transaction(async (tx) => {
      const row = await tx.sysConfig.upsert({
        where: { key },
        create: {
          key,
          value,
          descripcion: descripcion ?? null,
          updatedById: actorId,
        },
        update: {
          value,
          descripcion: descripcion ?? null,
          updatedById: actorId,
        },
        select: sysConfigSelect,
      });

      if (this.audit) {
        await this.audit(
          {
            action: previous ? "SYS_CONFIG_UPDATED" : "SYS_CONFIG_CREATED",
            entityType: "SysConfig",
            entityId: key,
            userId: actorId,
            userName: row.updatedBy?.name ?? undefined,
            previousState: previous
              ? { value: previous.value, descripcion: previous.descripcion }
              : undefined,
            newState: { value, descripcion: descripcion ?? null },
          },
          tx
        );
      }
      return row;
    });

    this.cacheSet(key, updated.value);
    return updated;
  }

  /**
   * Seed inicial sin actor humano. Pensado para el boot: si la fila no
   * existe, copia el valor legado (env) a la tabla. Si ya existe, no
   * toca nada. No emite log de auditoría (es bootstrap, no acción de
   * usuario). Devuelve la fila resultante.
   */
  async seedFromValue(
    key: string,
    value: string,
    descripcion?: string
  ): Promise<SysConfigRecord> {
    assertSysConfigKey(key);
    const existing = await this.db.sysConfig.findUnique({
      where: { key },
      select: sysConfigSelect,
    });
    if (existing) {
      this.cacheSet(key, existing.value);
      return existing;
    }
    const row = await this.db.sysConfig.create({
      data: {
        key,
        value,
        descripcion: descripcion ?? null,
        updatedById: null,
      },
      select: sysConfigSelect,
    });
    this.cacheSet(key, row.value);
    return row;
  }

  async remove(key: string, actorId: string): Promise<void> {
    assertSysConfigKey(key);
    await this.db.$transaction(async (tx) => {
      const previous = await tx.sysConfig.findUnique({
        where: { key },
        select: { value: true, descripcion: true },
      });
      if (!previous) {
        throw new HttpError(404, "Configuración no encontrada");
      }

      await tx.sysConfig.delete({ where: { key } });

      if (this.audit) {
        await this.audit(
          {
            action: "SYS_CONFIG_DELETED",
            entityType: "SysConfig",
            entityId: key,
            userId: actorId,
            previousState: {
              value: previous.value,
              descripcion: previous.descripcion,
            },
          },
          tx
        );
      }
    });
    this.invalidate(key);
  }
}