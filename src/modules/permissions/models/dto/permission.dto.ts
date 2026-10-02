import { HttpError } from "@core/middlewares/error.middleware";
import { SCOPES, isRole, type PermissionScope } from "@core/permissions";
import { z, registry } from "@core/swagger/registry";

/** Formato de clave de permiso: `modulo.accion`, minúsculas y guion bajo. */
export const PermissionKey = /^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/;
export const PERMISSION_KEY_MAX = 100;

/** Formato de clave de rol: MAYÚSCULAS, dígitos y guion bajo. */
export const RoleKey = /^[A-Z][A-Z0-9_]*$/;
export const ROLE_KEY_MAX = 50;

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
  role: string;
  permission: string;
  scope: PermissionScope;
}

export interface RoleCreateInput {
  key: string;
  name: string;
  description?: string;
  module?: string;
  staff?: boolean;
  sortOrder?: number;
  /** Duplicar: copia la matriz de este rol al rol nuevo. */
  copyFrom?: string;
}

export interface RoleUpdateInput {
  name?: string;
  description?: string | null;
  module?: string | null;
  staff?: boolean;
  active?: boolean;
  sortOrder?: number;
}

const isScope = (v: unknown): v is PermissionScope =>
  typeof v === "string" && (SCOPES as readonly string[]).includes(v);

const asRecord = (body: unknown): Record<string, unknown> => {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new HttpError(400, "INVALID_BODY");
  }
  return body as Record<string, unknown>;
};

const parseKey = (v: unknown): string => {
  if (typeof v !== "string" || !PermissionKey.test(v)) {
    throw new HttpError(400, "INVALID_PERMISSION_KEY");
  }
  if (v.length > PERMISSION_KEY_MAX) {
    throw new HttpError(400, "KEY_TOO_LONG", { max: PERMISSION_KEY_MAX });
  }
  return v;
};

const parseRequiredString = (v: unknown, field: string, max: number): string => {
  if (typeof v !== "string" || v.trim().length === 0) {
    throw new HttpError(400, "FIELD_REQUIRED", { field });
  }
  if (v.length > max) {
    throw new HttpError(400, "FIELD_TOO_LONG", { field, max });
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
    throw new HttpError(400, "FIELD_MUST_BE_STRING", { field });
  }
  if (v.length > max) {
    throw new HttpError(400, "FIELD_TOO_LONG", { field, max });
  }
  return v;
};

const parseOptionalBoolean = (v: unknown, field: string): boolean | undefined => {
  if (v === undefined) return undefined;
  if (typeof v !== "boolean") {
    throw new HttpError(400, "FIELD_MUST_BE_BOOLEAN", { field });
  }
  return v;
};

const parseOptionalSortOrder = (v: unknown): number | undefined => {
  if (v === undefined) return undefined;
  if (typeof v !== "number" || !Number.isInteger(v) || v < 0) {
    throw new HttpError(400, "INVALID_SORT_ORDER");
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
    throw new HttpError(400, "SCOPES_REQUIRED");
  }
  const vistos = new Set<PermissionScope>();
  for (const item of v) {
    if (!isScope(item)) {
      throw new HttpError(400, "INVALID_SCOPE", { scope: String(item) });
    }
    if (vistos.has(item)) {
      throw new HttpError(400, "DUPLICATE_SCOPE", { scope: item });
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
    throw new HttpError(400, "UPDATE_FIELDS_REQUIRED");
  }
  return dto;
};

/** Valida el body de actualización de la matriz rol → permiso → alcance. */
export const parseMatrixBody = (body: unknown): { changes: MatrixChange[] } => {
  const b = asRecord(body);
  if (!Array.isArray(b.changes) || b.changes.length === 0) {
    throw new HttpError(400, "CHANGES_ARRAY_REQUIRED");
  }
  if (b.changes.length > 500) {
    throw new HttpError(400, "TOO_MANY_CHANGES", { max: 500 });
  }
  const changes: MatrixChange[] = b.changes.map((raw, index) => {
    const row = asRecord(raw);
    if (typeof row.role !== "string" || !isRole(row.role)) {
      throw new HttpError(400, "INVALID_CHANGE_ROLE", { index, role: String(row.role) });
    }
    if (typeof row.permission !== "string" || row.permission.trim().length === 0) {
      throw new HttpError(400, "CHANGE_PERMISSION_REQUIRED", { index });
    }
    if (row.permission.length > PERMISSION_KEY_MAX) {
      throw new HttpError(400, "CHANGE_PERMISSION_TOO_LONG", { index, max: PERMISSION_KEY_MAX });
    }
    if (!isScope(row.scope)) {
      throw new HttpError(400, "INVALID_CHANGE_SCOPE", { index, scope: String(row.scope) });
    }
    return {
      role: row.role,
      permission: row.permission,
      scope: row.scope,
    };
  });
  return { changes };
};

// --- Roles ----------------------------------------------------------------

/** Valida y normaliza la clave de un rol (`MAYUSCULAS_GUION_BAJO`). */
export const parseRoleKey = (v: unknown): string => {
  if (typeof v !== "string" || !RoleKey.test(v)) {
    throw new HttpError(400, "INVALID_ROLE_KEY");
  }
  if (v.length > ROLE_KEY_MAX) {
    throw new HttpError(400, "ROLE_KEY_TOO_LONG", { max: ROLE_KEY_MAX });
  }
  return v;
};

/** Valida el body de creación de un rol. */
export const parseRoleCreateBody = (body: unknown): RoleCreateInput => {
  const b = asRecord(body);
  return {
    key: parseRoleKey(b.key),
    name: parseRequiredString(b.name, "name", 100),
    description: parseOptionalString(b.description, "description", 300),
    module: parseOptionalString(b.module, "module", 60),
    staff: parseOptionalBoolean(b.staff, "staff"),
    sortOrder: parseOptionalSortOrder(b.sortOrder),
    copyFrom: b.copyFrom === undefined || b.copyFrom === null ? undefined : parseRoleKey(b.copyFrom),
  };
};

/** Valida el body de actualización de un rol (al menos un campo). */
export const parseRoleUpdateBody = (body: unknown): RoleUpdateInput => {
  const b = asRecord(body);
  const dto: RoleUpdateInput = {};

  if (Object.prototype.hasOwnProperty.call(b, "name")) {
    dto.name = parseRequiredString(b.name, "name", 100);
  }
  if (Object.prototype.hasOwnProperty.call(b, "description")) {
    dto.description =
      b.description === null ? null : parseOptionalString(b.description, "description", 300);
  }
  if (Object.prototype.hasOwnProperty.call(b, "module")) {
    dto.module = b.module === null ? null : parseOptionalString(b.module, "module", 60);
  }
  if (Object.prototype.hasOwnProperty.call(b, "staff")) {
    dto.staff = parseOptionalBoolean(b.staff, "staff");
  }
  if (Object.prototype.hasOwnProperty.call(b, "active")) {
    dto.active = parseOptionalBoolean(b.active, "active");
  }
  if (Object.prototype.hasOwnProperty.call(b, "sortOrder")) {
    dto.sortOrder = parseOptionalSortOrder(b.sortOrder);
  }

  if (Object.keys(dto).length === 0) {
    throw new HttpError(400, "UPDATE_FIELDS_REQUIRED");
  }
  return dto;
};

// --- Schemas de Swagger ---------------------------------------------------

const scopeSchema = z.enum(["NONE", "OWN", "AREA", "ALL"]);
const roleSchema = z
  .string()
  .min(1)
  .max(ROLE_KEY_MAX)
  .regex(RoleKey, "ROLE_KEY_FORMAT");
const keySchema = z
  .string()
  .min(3)
  .max(PERMISSION_KEY_MAX)
  .regex(PermissionKey, "PERMISSION_KEY_FORMAT");

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

export const RoleSchema = registry.register(
  "Role",
  z.object({
    key: z.string(),
    name: z.string(),
    description: z.string().nullable(),
    module: z.string().nullable(),
    staff: z.boolean(),
    system: z.boolean(),
    active: z.boolean(),
    sortOrder: z.number().int(),
    userCount: z.number().int(),
  })
);

export const RoleListSchema = registry.register("RoleList", z.array(RoleSchema));

export const RoleCreateSchema = registry.register(
  "RoleCreateInput",
  z.object({
    key: z
      .string()
      .min(3)
      .max(ROLE_KEY_MAX)
      .regex(RoleKey, "ROLE_KEY_FORMAT"),
    name: z.string().min(1).max(100),
    description: z.string().max(300).optional(),
    module: z.string().max(60).optional(),
    staff: z.boolean().optional(),
    sortOrder: z.number().int().min(0).optional(),
    copyFrom: z.string().max(ROLE_KEY_MAX).optional(),
  })
);

export const RoleUpdateSchema = registry.register(
  "RoleUpdateInput",
  z.object({
    name: z.string().min(1).max(100).optional(),
    description: z.string().max(300).nullable().optional(),
    module: z.string().max(60).nullable().optional(),
    staff: z.boolean().optional(),
    active: z.boolean().optional(),
    sortOrder: z.number().int().min(0).optional(),
  })
);
