import { Role } from "@prisma/client";
import { HttpError } from "@core/middlewares/error.middleware";
import { ALCANCES, type Alcance } from "@core/permisos";
import { z, registry } from "@core/swagger/registry";

/** Formato de clave de permiso: `modulo.accion`, minúsculas y guion bajo. */
export const PermisoClave = /^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/;
export const PERMISO_CLAVE_MAX = 100;

/** Roles del sistema, en el orden del enum de Prisma. */
export const ROLES: Role[] = Object.values(Role);

export interface PermisoCatalogoCreateInput {
  clave: string;
  modulo: string;
  nombre: string;
  descripcion?: string;
  alcances: Alcance[];
  sensible?: boolean;
  orden?: number;
}

export interface PermisoCatalogoUpdateInput {
  modulo?: string;
  nombre?: string;
  descripcion?: string | null;
  alcances?: Alcance[];
  sensible?: boolean;
  activo?: boolean;
  orden?: number;
}

export interface MatrizCambio {
  rol: Role;
  permiso: string;
  alcance: Alcance;
}

const esAlcance = (v: unknown): v is Alcance =>
  typeof v === "string" && (ALCANCES as readonly string[]).includes(v);

const asRecord = (body: unknown): Record<string, unknown> => {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new HttpError(400, "Body inválido");
  }
  return body as Record<string, unknown>;
};

const parseClave = (v: unknown): string => {
  if (typeof v !== "string" || !PermisoClave.test(v)) {
    throw new HttpError(
      400,
      "La clave debe tener el formato modulo.accion (minúsculas, dígitos y guion bajo)"
    );
  }
  if (v.length > PERMISO_CLAVE_MAX) {
    throw new HttpError(400, `La clave excede ${PERMISO_CLAVE_MAX} caracteres`);
  }
  return v;
};

const parseRequiredString = (v: unknown, field: string, max: number): string => {
  if (typeof v !== "string" || v.trim().length === 0) {
    throw new HttpError(400, `${field} es obligatorio`);
  }
  if (v.length > max) {
    throw new HttpError(400, `${field} excede ${max} caracteres`);
  }
  return v;
};

const parseOptionalString = (
  v: unknown,
  field: string,
  max: number
): string | undefined => {
  if (v === undefined) return undefined;
  if (v === null) return undefined;
  if (typeof v !== "string") {
    throw new HttpError(400, `${field} debe ser string`);
  }
  if (v.length > max) {
    throw new HttpError(400, `${field} excede ${max} caracteres`);
  }
  return v;
};

const parseOptionalBoolean = (v: unknown, field: string): boolean | undefined => {
  if (v === undefined) return undefined;
  if (typeof v !== "boolean") {
    throw new HttpError(400, `${field} debe ser booleano`);
  }
  return v;
};

const parseOptionalOrden = (v: unknown): number | undefined => {
  if (v === undefined) return undefined;
  if (typeof v !== "number" || !Number.isInteger(v) || v < 0) {
    throw new HttpError(400, "orden debe ser un entero mayor o igual a 0");
  }
  return v;
};

/**
 * Normaliza y valida una lista de alcances: arreglo no vacío, subconjunto del
 * enum `Alcance`, sin duplicados y en el orden canónico
 * `NINGUNO, PROPIO, AREA, TODO`. **Puro.**
 */
export const parseAlcances = (v: unknown): Alcance[] => {
  if (!Array.isArray(v) || v.length === 0) {
    throw new HttpError(400, "alcances debe ser un arreglo no vacío");
  }
  const vistos = new Set<Alcance>();
  for (const item of v) {
    if (!esAlcance(item)) {
      throw new HttpError(400, `Alcance inválido: ${String(item)}`);
    }
    if (vistos.has(item)) {
      throw new HttpError(400, `Alcance duplicado: ${item}`);
    }
    vistos.add(item);
  }
  return ALCANCES.filter((alcance) => vistos.has(alcance));
};

/** Valida el body de creación de un permiso del catálogo. */
export const parseCatalogoCreateBody = (body: unknown): PermisoCatalogoCreateInput => {
  const b = asRecord(body);
  return {
    clave: parseClave(b.clave),
    modulo: parseRequiredString(b.modulo, "modulo", 80),
    nombre: parseRequiredString(b.nombre, "nombre", 150),
    descripcion: parseOptionalString(b.descripcion, "descripcion", 500),
    alcances: parseAlcances(b.alcances),
    sensible: parseOptionalBoolean(b.sensible, "sensible"),
    orden: parseOptionalOrden(b.orden),
  };
};

/**
 * Valida el body de actualización. Devuelve solo los campos presentes (al
 * menos uno). `descripcion: null` es válido y limpia el campo.
 */
export const parseCatalogoUpdateBody = (body: unknown): PermisoCatalogoUpdateInput => {
  const b = asRecord(body);
  const dto: PermisoCatalogoUpdateInput = {};

  if (Object.prototype.hasOwnProperty.call(b, "modulo")) {
    dto.modulo = parseRequiredString(b.modulo, "modulo", 80);
  }
  if (Object.prototype.hasOwnProperty.call(b, "nombre")) {
    dto.nombre = parseRequiredString(b.nombre, "nombre", 150);
  }
  if (Object.prototype.hasOwnProperty.call(b, "descripcion")) {
    if (b.descripcion !== null) {
      dto.descripcion = parseOptionalString(b.descripcion, "descripcion", 500);
    } else {
      dto.descripcion = null;
    }
  }
  if (Object.prototype.hasOwnProperty.call(b, "alcances")) {
    dto.alcances = parseAlcances(b.alcances);
  }
  if (Object.prototype.hasOwnProperty.call(b, "sensible")) {
    dto.sensible = parseOptionalBoolean(b.sensible, "sensible");
  }
  if (Object.prototype.hasOwnProperty.call(b, "activo")) {
    dto.activo = parseOptionalBoolean(b.activo, "activo");
  }
  if (Object.prototype.hasOwnProperty.call(b, "orden")) {
    dto.orden = parseOptionalOrden(b.orden);
  }

  if (Object.keys(dto).length === 0) {
    throw new HttpError(400, "Debe enviar al menos un campo para actualizar");
  }
  return dto;
};

/** Valida el body de actualización de la matriz rol → permiso → alcance. */
export const parseMatrizBody = (body: unknown): { cambios: MatrizCambio[] } => {
  const b = asRecord(body);
  if (!Array.isArray(b.cambios) || b.cambios.length === 0) {
    throw new HttpError(400, "cambios debe ser un arreglo no vacío");
  }
  if (b.cambios.length > 500) {
    throw new HttpError(400, "cambios admite máximo 500 filas por petición");
  }
  const cambios: MatrizCambio[] = b.cambios.map((raw, index) => {
    const fila = asRecord(raw);
    if (typeof fila.rol !== "string" || !ROLES.includes(fila.rol as Role)) {
      throw new HttpError(400, `cambios[${index}].rol inválido: ${String(fila.rol)}`);
    }
    if (typeof fila.permiso !== "string" || fila.permiso.trim().length === 0) {
      throw new HttpError(400, `cambios[${index}].permiso es obligatorio`);
    }
    if (fila.permiso.length > PERMISO_CLAVE_MAX) {
      throw new HttpError(400, `cambios[${index}].permiso excede ${PERMISO_CLAVE_MAX} caracteres`);
    }
    if (!esAlcance(fila.alcance)) {
      throw new HttpError(400, `cambios[${index}].alcance inválido: ${String(fila.alcance)}`);
    }
    return {
      rol: fila.rol as Role,
      permiso: fila.permiso,
      alcance: fila.alcance,
    };
  });
  return { cambios };
};

// --- Schemas de Swagger ---------------------------------------------------

const alcanceSchema = z.enum(["NINGUNO", "PROPIO", "AREA", "TODO"]);
const roleSchema = z.enum(ROLES as [Role, ...Role[]]);
const claveSchema = z
  .string()
  .min(3)
  .max(PERMISO_CLAVE_MAX)
  .regex(PermisoClave, "Formato modulo.accion");

export const PermisoCatalogoSchema = registry.register(
  "PermisoCatalogo",
  z.object({
    clave: z.string(),
    modulo: z.string(),
    nombre: z.string(),
    descripcion: z.string().nullable(),
    alcances: z.array(alcanceSchema),
    sensible: z.boolean(),
    activo: z.boolean(),
    orden: z.number().int(),
  })
);

export const PermisoCatalogoListSchema = registry.register(
  "PermisoCatalogoList",
  z.array(PermisoCatalogoSchema)
);

export const PermisoCatalogoCreateSchema = registry.register(
  "PermisoCatalogoCreateInput",
  z.object({
    clave: claveSchema,
    modulo: z.string().min(1).max(80),
    nombre: z.string().min(1).max(150),
    descripcion: z.string().max(500).optional(),
    alcances: z.array(alcanceSchema).min(1),
    sensible: z.boolean().optional(),
    orden: z.number().int().min(0).optional(),
  })
);

export const PermisoCatalogoUpdateSchema = registry.register(
  "PermisoCatalogoUpdateInput",
  z.object({
    modulo: z.string().min(1).max(80).optional(),
    nombre: z.string().min(1).max(150).optional(),
    descripcion: z.string().max(500).nullable().optional(),
    alcances: z.array(alcanceSchema).min(1).optional(),
    sensible: z.boolean().optional(),
    activo: z.boolean().optional(),
    orden: z.number().int().min(0).optional(),
  })
);

export const PermisoMatrizUpdateSchema = registry.register(
  "PermisoMatrizUpdateInput",
  z.object({
    cambios: z
      .array(
        z.object({
          rol: roleSchema,
          permiso: claveSchema,
          alcance: alcanceSchema,
        })
      )
      .min(1)
      .max(500),
  })
);

export const RolesAdminResponseSchema = registry.register(
  "RolesAdminResponse",
  z.object({
    roles: z.array(roleSchema),
    catalogo: z.array(PermisoCatalogoSchema),
    matriz: z.array(
      z.object({
        rol: roleSchema,
        permiso: z.string(),
        alcance: alcanceSchema,
      })
    ),
  })
);
