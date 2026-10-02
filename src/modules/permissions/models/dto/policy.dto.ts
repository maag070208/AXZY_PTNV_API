import { HttpError } from "@core/middlewares/error.middleware";
import { isRole } from "@core/permissions";
import {
  OPERATORS_WITHOUT_VALUE,
  POLICY_ACTIONS,
  POLICY_OPERATORS,
  policyAction,
  type PolicyOperator,
} from "@core/policies";
import { z, registry } from "@core/swagger/registry";

export interface PolicyConditionInput {
  field: string;
  operator: string;
  value?: string | null;
}

export interface PolicyCreateInput {
  name: string;
  description?: string;
  action: string;
  effect: "ALLOW" | "DENY";
  priority?: number;
  active?: boolean;
  roles: string[];
  conditions: PolicyConditionInput[];
}

export interface PolicyUpdateInput {
  name?: string;
  description?: string | null;
  action?: string;
  effect?: "ALLOW" | "DENY";
  priority?: number;
  active?: boolean;
  roles?: string[];
  /** Condiciones crudas; el servicio las valida contra la acción efectiva. */
  conditionsRaw?: unknown;
}

const asRecord = (body: unknown): Record<string, unknown> => {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new HttpError(400, "INVALID_BODY");
  }
  return body as Record<string, unknown>;
};

const parseEffect = (v: unknown): "ALLOW" | "DENY" => {
  if (v !== "ALLOW" && v !== "DENY") throw new HttpError(400, "INVALID_POLICY_EFFECT");
  return v;
};

const parsePriority = (v: unknown): number => {
  if (typeof v !== "number" || !Number.isInteger(v) || v < 0) {
    throw new HttpError(400, "INVALID_SORT_ORDER");
  }
  return v;
};

const parseRoles = (v: unknown): string[] => {
  if (!Array.isArray(v)) throw new HttpError(400, "FIELD_MUST_BE_STRING", { field: "roles" });
  const roles = [...new Set(v)];
  for (const role of roles) {
    if (typeof role !== "string" || !isRole(role)) {
      throw new HttpError(400, "INVALID_POLICY_ROLE", { role: String(role) });
    }
  }
  return roles as string[];
};

/** Valida las condiciones contra los campos declarados por la acción. */
export const parseConditions = (v: unknown, action: string): PolicyConditionInput[] => {
  const definition = policyAction(action);
  if (!definition) throw new HttpError(400, "INVALID_POLICY_ACTION", { action });
  if (!Array.isArray(v)) throw new HttpError(400, "INVALID_BODY");
  const fieldByKey = new Map(definition.fields.map((f) => [f.key, f]));

  return v.map((raw, index) => {
    const row = asRecord(raw);
    const field = row.field;
    if (typeof field !== "string" || !fieldByKey.has(field)) {
      throw new HttpError(400, "INVALID_POLICY_FIELD", { index, field: String(field) });
    }
    const operator = row.operator;
    if (typeof operator !== "string" || !(POLICY_OPERATORS as readonly string[]).includes(operator)) {
      throw new HttpError(400, "INVALID_POLICY_OPERATOR", { index, operator: String(operator) });
    }
    const needsValue = !(OPERATORS_WITHOUT_VALUE as readonly string[]).includes(operator as PolicyOperator);
    let value: string | null = null;
    if (needsValue) {
      if (row.value === undefined || row.value === null || row.value === "") {
        throw new HttpError(400, "POLICY_VALUE_REQUIRED", { index });
      }
      value = String(row.value);
      const def = fieldByKey.get(field)!;
      // Los campos de catálogo solo admiten valores declarados (eq / in / not_in).
      if (def.type === "enum" && ["eq", "neq", "in", "not_in"].includes(operator)) {
        const list = value.split(",").map((item) => item.trim());
        const allowed = new Set(def.options ?? []);
        for (const item of list) {
          if (!allowed.has(item)) {
            throw new HttpError(400, "INVALID_POLICY_VALUE", { index, value: item });
          }
        }
      }
    }
    return { field, operator, value };
  });
};

const parseAction = (v: unknown): string => {
  if (typeof v !== "string" || !policyAction(v)) {
    throw new HttpError(400, "INVALID_POLICY_ACTION", { action: String(v) });
  }
  return v;
};

export const parsePolicyCreateBody = (body: unknown): PolicyCreateInput => {
  const b = asRecord(body);
  if (typeof b.name !== "string" || !b.name.trim()) throw new HttpError(400, "FIELD_REQUIRED", { field: "name" });
  const action = parseAction(b.action);
  return {
    name: b.name,
    description: typeof b.description === "string" ? b.description : undefined,
    action,
    effect: parseEffect(b.effect),
    priority: b.priority === undefined ? undefined : parsePriority(b.priority),
    active: b.active === undefined ? undefined : Boolean(b.active),
    roles: parseRoles(b.roles ?? []),
    conditions: parseConditions(b.conditions ?? [], action),
  };
};

export const parsePolicyUpdateBody = (body: unknown): PolicyUpdateInput => {
  const b = asRecord(body);
  const dto: PolicyUpdateInput = {};
  if (Object.prototype.hasOwnProperty.call(b, "name")) {
    if (typeof b.name !== "string" || !b.name.trim()) throw new HttpError(400, "FIELD_REQUIRED", { field: "name" });
    dto.name = b.name;
  }
  if (Object.prototype.hasOwnProperty.call(b, "description")) {
    dto.description = b.description === null ? null : String(b.description);
  }
  if (Object.prototype.hasOwnProperty.call(b, "action")) dto.action = parseAction(b.action);
  if (Object.prototype.hasOwnProperty.call(b, "effect")) dto.effect = parseEffect(b.effect);
  if (Object.prototype.hasOwnProperty.call(b, "priority")) dto.priority = parsePriority(b.priority);
  if (Object.prototype.hasOwnProperty.call(b, "active")) dto.active = Boolean(b.active);
  if (Object.prototype.hasOwnProperty.call(b, "roles")) dto.roles = parseRoles(b.roles);
  if (Object.prototype.hasOwnProperty.call(b, "conditions")) {
    // Se validan en el servicio con la acción efectiva de la política.
    dto.conditionsRaw = b.conditions;
  }
  if (Object.keys(dto).length === 0) throw new HttpError(400, "UPDATE_FIELDS_REQUIRED");
  return dto;
};

// --- Schemas de Swagger ---------------------------------------------------

const conditionSchema = z.object({
  field: z.string(),
  operator: z.enum(POLICY_OPERATORS as unknown as [PolicyOperator, ...PolicyOperator[]]),
  value: z.string().nullable().optional(),
});

const effectSchema = z.enum(["ALLOW", "DENY"]);
const actionSchema = z.enum(POLICY_ACTIONS.map((a) => a.key) as unknown as [string, ...string[]]);

export const PolicySchema = registry.register(
  "Policy",
  z.object({
    id: z.string(),
    key: z.string().nullable(),
    name: z.string(),
    description: z.string().nullable(),
    action: z.string(),
    effect: effectSchema,
    priority: z.number().int(),
    active: z.boolean(),
    roles: z.array(z.string()),
    conditions: z.array(z.object({ field: z.string(), operator: z.string(), value: z.string().nullable() })),
    createdAt: z.string(),
  })
);

export const PolicyListSchema = registry.register(
  "PolicyList",
  z.object({ policies: z.array(PolicySchema), actions: z.array(z.object({}).passthrough()) })
);

export const PolicyCreateSchema = registry.register(
  "PolicyCreateInput",
  z.object({
    name: z.string().min(1).max(150),
    description: z.string().max(500).optional(),
    action: actionSchema,
    effect: effectSchema,
    priority: z.number().int().min(0).optional(),
    active: z.boolean().optional(),
    roles: z.array(z.string()).optional(),
    conditions: z.array(conditionSchema).optional(),
  })
);

export const PolicyUpdateSchema = registry.register(
  "PolicyUpdateInput",
  z.object({
    name: z.string().min(1).max(150).optional(),
    description: z.string().max(500).nullable().optional(),
    action: actionSchema.optional(),
    effect: effectSchema.optional(),
    priority: z.number().int().min(0).optional(),
    active: z.boolean().optional(),
    roles: z.array(z.string()).optional(),
    conditions: z.array(conditionSchema).optional(),
  })
);
