import type { Permiso, Prisma, PrismaClient } from "@prisma/client";
import { prismaClient } from "@core/config/database";
import { HttpError } from "@core/middlewares/error.middleware";
import { cargarPermisosDesdeDb } from "@core/permisos";
import type { AuditLogger } from "@modules/users/services/user.service";
import {
  ROLES,
  type MatrizCambio,
  type PermisoCatalogoCreateInput,
  type PermisoCatalogoUpdateInput,
} from "../models/dto/permiso.dto";
import type {
  PermisoCatalogo,
  RolesAdminData,
} from "../models/entity/permiso.entity";

const MATRIZ_MAX = 500;
const PERMISO_ADMIN = "roles.administrar";

const toCatalogo = (row: Permiso): PermisoCatalogo => ({
  clave: row.clave,
  modulo: row.modulo,
  nombre: row.nombre,
  descripcion: row.descripcion ?? null,
  alcances: [...row.alcances],
  sensible: row.sensible,
  activo: row.activo,
  orden: row.orden,
});

const estadoCatalogo = (row: Permiso) => ({
  modulo: row.modulo,
  nombre: row.nombre,
  descripcion: row.descripcion ?? null,
  alcances: [...row.alcances],
  sensible: row.sensible,
  activo: row.activo,
  orden: row.orden,
});

/**
 * Administración del catálogo de permisos y de la matriz rol → permiso →
 * alcance. Desde el Incremento 2 ambas viven en la BD (`permisos`,
 * `rol_permisos`); el núcleo `@core/permisos` mantiene la cache en memoria y
 * este servicio la recarga tras cada escritura.
 *
 * Cada mutación se audita dentro de la misma `$transaction` que el cambio
 * (mismo patrón que `SysConfigService`): si la transacción falla, el log no se
 * escribe. La recarga de caches ocurre **después** del commit, para no dejar
 * memoria y BD desincronizadas.
 */
export class PermisoService {
  constructor(
    private readonly db: PrismaClient = prismaClient,
    private readonly audit?: AuditLogger
  ) {}

  /** Roles, catálogo completo (incluye inactivos) y matriz con alcance ≠ NINGUNO. */
  async adminData(): Promise<RolesAdminData> {
    const [catalogo, matriz] = await Promise.all([
      this.db.permiso.findMany({ orderBy: [{ modulo: "asc" }, { orden: "asc" }] }),
      this.db.rolPermiso.findMany({
        where: { alcance: { not: "NINGUNO" } },
        select: { rol: true, permiso: true, alcance: true },
      }),
    ]);

    return {
      roles: [...ROLES],
      catalogo: catalogo.map(toCatalogo),
      matriz: matriz.map((fila) => ({
        rol: fila.rol,
        permiso: fila.permiso,
        alcance: fila.alcance,
      })),
    };
  }

  /** Catálogo activo, para que la web resuelva nombres de permiso. */
  async getCatalogoActivo(): Promise<PermisoCatalogo[]> {
    const rows = await this.db.permiso.findMany({
      where: { activo: true },
      orderBy: [{ modulo: "asc" }, { orden: "asc" }],
    });
    return rows.map(toCatalogo);
  }

  async createCatalogo(
    dto: PermisoCatalogoCreateInput,
    actorId: string
  ): Promise<PermisoCatalogo> {
    const existente = await this.db.permiso.findUnique({ where: { clave: dto.clave } });
    if (existente) {
      throw new HttpError(409, `Ya existe un permiso con la clave "${dto.clave}"`);
    }

    const creado = await this.db.$transaction(async (tx) => {
      const row = await tx.permiso.create({
        data: {
          clave: dto.clave,
          modulo: dto.modulo,
          nombre: dto.nombre,
          descripcion: dto.descripcion ?? null,
          alcances: dto.alcances,
          sensible: dto.sensible ?? false,
          orden: dto.orden ?? 0,
        },
      });

      if (this.audit) {
        await this.audit(
          {
            action: "PERMISO_CATALOGO_CREADO",
            entityType: "Permiso",
            entityId: row.clave,
            userId: actorId,
            newState: estadoCatalogo(row),
          },
          tx
        );
      }
      return row;
    });

    await cargarPermisosDesdeDb(this.db);
    return toCatalogo(creado);
  }

  async updateCatalogo(
    clave: string,
    dto: PermisoCatalogoUpdateInput,
    actorId: string
  ): Promise<PermisoCatalogo> {
    const previous = await this.db.permiso.findUnique({ where: { clave } });
    if (!previous) {
      throw new HttpError(404, `Permiso no encontrado: ${clave}`);
    }

    const data: Prisma.PermisoUpdateInput = {};
    if (dto.modulo !== undefined) data.modulo = dto.modulo;
    if (dto.nombre !== undefined) data.nombre = dto.nombre;
    if (dto.descripcion !== undefined) data.descripcion = dto.descripcion;
    if (dto.sensible !== undefined) data.sensible = dto.sensible;
    if (dto.activo !== undefined) data.activo = dto.activo;
    if (dto.orden !== undefined) data.orden = dto.orden;

    if (dto.alcances !== undefined) {
      const concesiones = await this.db.rolPermiso.findMany({ where: { permiso: clave } });
      const fuera = concesiones.filter(
        (fila) => fila.alcance !== "NINGUNO" && !dto.alcances!.includes(fila.alcance)
      );
      if (fuera.length > 0) {
        const detalle = fuera.map((fila) => `${fila.rol}=${fila.alcance}`).join(", ");
        throw new HttpError(
          409,
          `No se pueden quitar alcances con concesiones activas (${detalle})`,
          { concesiones: fuera.map((fila) => ({ rol: fila.rol, alcance: fila.alcance })) }
        );
      }
      data.alcances = dto.alcances;
    }

    if (Object.keys(data).length === 0) {
      throw new HttpError(400, "Debe enviar al menos un campo para actualizar");
    }

    const previousState = estadoCatalogo(previous);

    const actualizado = await this.db.$transaction(async (tx) => {
      const row = await tx.permiso.update({ where: { clave }, data });

      if (this.audit) {
        await this.audit(
          {
            action: "PERMISO_CATALOGO_ACTUALIZADO",
            entityType: "Permiso",
            entityId: clave,
            userId: actorId,
            previousState,
            newState: estadoCatalogo(row),
          },
          tx
        );
      }
      return row;
    });

    await cargarPermisosDesdeDb(this.db);
    return toCatalogo(actualizado);
  }

  /**
   * Aplica un lote de celdas de la matriz. Valida cada fila contra el catálogo
   * (permiso existente y activo, alcance permitido), impide el lockout de
   * ADMIN sobre `roles.administrar` y escribe también los `NINGUNO` (tombstone:
   * nunca borra filas). Audita celda por celda y recarga la cache tras commit.
   */
  async saveMatriz(
    cambios: MatrizCambio[],
    actorId: string
  ): Promise<{ updated: number }> {
    if (cambios.length === 0) {
      throw new HttpError(400, "Debe enviar al menos un cambio");
    }
    if (cambios.length > MATRIZ_MAX) {
      throw new HttpError(400, `cambios admite máximo ${MATRIZ_MAX} filas por petición`);
    }

    const claves = [...new Set(cambios.map((cambio) => cambio.permiso))];
    const permisos = await this.db.permiso.findMany({ where: { clave: { in: claves } } });
    const porClave = new Map(permisos.map((permiso) => [permiso.clave, permiso]));

    for (const cambio of cambios) {
      if (!ROLES.includes(cambio.rol)) {
        throw new HttpError(400, `Rol inválido: ${cambio.rol}`);
      }
      const definicion = porClave.get(cambio.permiso);
      if (!definicion) {
        throw new HttpError(400, `El permiso "${cambio.permiso}" no existe`);
      }
      if (!definicion.activo) {
        throw new HttpError(400, `El permiso "${cambio.permiso}" está inactivo`);
      }
      const validos = new Set<string>([...definicion.alcances, "NINGUNO"]);
      if (!validos.has(cambio.alcance)) {
        throw new HttpError(
          400,
          `Alcance inválido para "${cambio.permiso}": ${cambio.alcance}`
        );
      }
    }

    const dejaSinAdmin = cambios.some(
      (cambio) =>
        cambio.rol === "ADMIN" &&
        cambio.permiso === PERMISO_ADMIN &&
        cambio.alcance === "NINGUNO"
    );
    if (dejaSinAdmin) {
      throw new HttpError(
        409,
        `No se puede dejar al rol ADMIN sin el permiso "${PERMISO_ADMIN}"`
      );
    }

    await this.db.$transaction(async (tx) => {
      const previos = await tx.rolPermiso.findMany({
        where: {
          OR: cambios.map((cambio) => ({ rol: cambio.rol, permiso: cambio.permiso })),
        },
      });
      const previosPorCelda = new Map(
        previos.map((fila) => [`${fila.rol}|${fila.permiso}`, fila.alcance])
      );

      for (const cambio of cambios) {
        const entityId = `${cambio.rol}|${cambio.permiso}`;
        const antes = previosPorCelda.get(entityId);

        await tx.rolPermiso.upsert({
          where: { rol_permiso: { rol: cambio.rol, permiso: cambio.permiso } },
          create: {
            rol: cambio.rol,
            permiso: cambio.permiso,
            alcance: cambio.alcance,
          },
          update: { alcance: cambio.alcance },
        });

        if (this.audit) {
          await this.audit(
            {
              action: "PERMISO_MATRIZ_ACTUALIZADA",
              entityType: "RolPermiso",
              entityId,
              userId: actorId,
              previousState: antes ? { alcance: antes } : undefined,
              newState: { alcance: cambio.alcance },
            },
            tx
          );
        }
      }
    });

    await cargarPermisosDesdeDb(this.db);
    return { updated: cambios.length };
  }

  /** Recarga catálogo y matriz desde la BD (útil en despliegues multi-instancia). */
  async reload(): Promise<void> {
    await cargarPermisosDesdeDb(this.db);
  }
}
