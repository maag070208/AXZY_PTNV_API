import { Role } from "@prisma/client";
import { HttpError } from "@core/middlewares/error.middleware";
import { SCOPES, type PermissionScope } from "@core/permissions";
import { z, registry } from "@core/swagger/registry";

/** Formato de clave de permiso: `modulo.accion`, minúsculas y guion bajo. */
export const PermissionKey = /^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/;
export const PERMISSION_KEY_MAX = 100;

/** Roles del sistema, en el orden del enum de Prisma. */
export const ROLES: Role[] = Object.values(Role);

export interface PermissionCatalogCreateInput {
  key: string;
  module: string;
  name: string;
  description?: string;
  scopes: PermissionScope[];
  sensitive?: boolean;
  sortOrder?: number;
}

export interface PermissionCatalogUpdateInput {
  module?: string;
  name?: string;
  description?: string | null;
  scopes?: PermissionScope[];
  sensitive?: boolean;
  active?: boolean;
  sortOrder?: number;
}

export interface MatrixChange {
  role: Role;
  permission: string;
  scope: PermissionScope;
}

const isScope = (v: unknown): v is PermissionScope =>
  typeof v === "string" && (SCOPES as readonly string[]).includes(v);

const asRecord = (body: unknown): Record<string, unknown> => {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new HttpError(400, "Body inválido");
  }
  return body as Record<string, unknown>;
};

const parseKey = (v: unknown): string => {
  if (typeof v !== "string" || !PermissionKey.test(v)) {
    throw new HttpError(
      400,
      "La clave debe tener el formato modulo.accion (minúsculas, dígitos y guion bajo)"
    );
  }
  if (v.length > PERMISSION_KEY_MAX) {
    throw new HttpError(400, `La clave excede ${PERMISSION_KEY_MAX} caracteres`);
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

const parseOptionalSortOrder = (v: unknown): number | undefined => {
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
export const parseScopes = (v: unknown): PermissionScope[] => {
  if (!Array.isArray(v) || v.length === 0) {
    throw new HttpError(400, "alcances debe ser un arreglo no vacío");
  }
  const vistos = new Set<PermissionScope>();
  for (const item of v) {
    if (!isScope(item)) {
      throw new HttpError(400, `Alcance inválido: ${String(item)}`);
    }
    if (vistos.has(item)) {
      throw new HttpError(400, `Alcance duplicado: ${item}`);
    }
    vistos.add(item);
  }
  return SCOPES.filter((scope) => vistos.has(scope));
};

/** Valida el body de creación de un permiso del catálogo. */
export const parseCatalogCreateBody = (body: unknown): PermissionCatalogCreateInput => {
  const b = asRecord(body);
  return {
    key: parseKey(b.key),
    module: parseRequiredString(b.module, "module", 80),
    name: parseRequiredString(b.name, "name", 150),
    description: parseOptionalString(b.description, "description", 500),
    scopes: parseScopes(b.scopes),
    sensitive: parseOptionalBoolean(b.sensitive, "sensitive"),
    sortOrder: parseOptionalSortOrder(b.sortOrder),
  };
};

/**
 * Valida el body de actualización. Devuelve solo los campos presentes (al
 * menos uno). `descripcion: null` es válido y limpia el campo.
 */
export const parseCatalogUpdateBody = (body: unknown): PermissionCatalogUpdateInput => {
  const b = asRecord(body);
  const dto: PermissionCatalogUpdateInput = {};

  if (Object.prototype.hasOwnProperty.call(b, "module")) {
    dto.module = parseRequiredString(b.module, "module", 80);
  }
  if (Object.prototype.hasOwnProperty.call(b, "name")) {
    dto.name = parseRequiredString(b.name, "name", 150);
  }
  if (Object.prototype.hasOwnProperty.call(b, "description")) {
    if (b.description !== null) {
      dto.description = parseOptionalString(b.description, "description", 500);
    } else {
      dto.description = null;
    }
  }
  if (Object.prototype.hasOwnProperty.call(b, "scopes")) {
    dto.scopes = parseScopes(b.scopes);
  }
  if (Object.prototype.hasOwnProperty.call(b, "sensitive")) {
    dto.sensitive = parseOptionalBoolean(b.sensitive, "sensitive");
  }
  if (Object.prototype.hasOwnProperty.call(b, "active")) {
    dto.active = parseOptionalBoolean(b.active, "active");
  }
  if (Object.prototype.hasOwnProperty.call(b, "sortOrder")) {
    dto.sortOrder = parseOptionalSortOrder(b.sortOrder);
  }

  if (Object.keys(dto).length === 0) {
    throw new HttpError(400, "Debe enviar al menos un campo para actualizar");
  }
  return dto;
};

/** Valida el body de actualización de la matriz rol → permiso → alcance. */
export const parseMatrixBody = (body: unknown): { changes: MatrixChange[] } => {
  const b = asRecord(body);
  if (!Array.isArray(b.changes) || b.changes.length === 0) {
    throw new HttpError(400, "cambios debe ser un arreglo no vacío");
  }
  if (b.changes.length > 500) {
    throw new HttpError(400, "cambios admite máximo 500 filas por petición");
  }
  const changes: MatrixChange[] = b.changes.map((raw, index) => {
    const row = asRecord(raw);
    if (typeof row.role !== "string" || !ROLES.includes(row.role as Role)) {
      throw new HttpError(400, `cambios[${index}].rol inválido: ${String(row.role)}`);
    }
    if (typeof row.permission !== "string" || row.permission.trim().length === 0) {
      throw new HttpError(400, `cambios[${index}].permiso es obligatorio`);
    }
    if (row.permission.length > PERMISSION_KEY_MAX) {
      throw new HttpError(400, `cambios[${index}].permiso excede ${PERMISSION_KEY_MAX} caracteres`);
    }
    if (!isScope(row.scope)) {
      throw new HttpError(400, `cambios[${index}].alcance inválido: ${String(row.scope)}`);
    }
    return {
      role: row.role as Role,
      permission: row.permission,
      scope: row.scope,
    };
  });
  return { changes };
};

// --- Schemas de Swagger ---------------------------------------------------

const scopeSchema = z.enum(["NONE", "OWN", "AREA", "ALL"]);
const roleSchema = z.enum(ROLES as [Role, ...Role[]]);
const keySchema = z
  .string()
  .min(3)
  .max(PERMISSION_KEY_MAX)
  .regex(PermissionKey, "Formato modulo.accion");

export const PermissionCatalogSchema = registry.register(
  "PermissionCatalog",
  z.object({
    key: z.string(),
    module: z.string(),
    name: z.string(),
    description: z.string().nullable(),
    scopes: z.array(scopeSchema),
    sensitive: z.boolean(),
    active: z.boolean(),
    sortOrder: z.number().int(),
  })
);

export const PermissionCatalogListSchema = registry.register(
  "PermissionCatalogList",
  z.array(PermissionCatalogSchema)
);

export const PermissionCatalogCreateSchema = registry.register(
  "PermissionCatalogCreateInput",
  z.object({
    key: keySchema,
    module: z.string().min(1).max(80),
    name: z.string().min(1).max(150),
    description: z.string().max(500).optional(),
    scopes: z.array(scopeSchema).min(1),
    sensitive: z.boolean().optional(),
    sortOrder: z.number().int().min(0).optional(),
  })
);

export const PermissionCatalogUpdateSchema = registry.register(
  "PermissionCatalogUpdateInput",
  z.object({
    module: z.string().min(1).max(80).optional(),
    name: z.string().min(1).max(150).optional(),
    description: z.string().max(500).nullable().optional(),
    scopes: z.array(scopeSchema).min(1).optional(),
    sensitive: z.boolean().optional(),
    active: z.boolean().optional(),
    sortOrder: z.number().int().min(0).optional(),
  })
);

export const PermissionMatrixUpdateSchema = registry.register(
  "PermissionMatrixUpdateInput",
  z.object({
    changes: z
      .array(
        z.object({
          role: roleSchema,
          permission: keySchema,
          scope: scopeSchema,
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
    catalog: z.array(PermissionCatalogSchema),
    matrix: z.array(
      z.object({
        role: roleSchema,
        permission: z.string(),
        scope: scopeSchema,
      })
    ),
  })
);
