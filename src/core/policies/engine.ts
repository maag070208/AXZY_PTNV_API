import type { PrismaClient } from "@prisma/client";
import { rolesOf } from "@core/permissions";
import { allow, deny, type PolicyDecision, type PolicyUser } from "./types";

/**
 * Motor de políticas ABAC (dinámicas). Las reglas viven en la BD y se cargan en
 * una cache en memoria (recargada tras cada escritura). Cada regla aplica a una
 * `action` (clave de permiso) y decide con **la primera que casa por prioridad**:
 * si niega, se rechaza; si permite o ninguna casa, se permite (el permiso RBAC
 * ya autorizó la acción).
 */
export type PolicyOperator =
  | "eq"
  | "neq"
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "in"
  | "not_in"
  | "is_empty"
  | "is_not_empty";

export const POLICY_OPERATORS: readonly PolicyOperator[] = [
  "eq",
  "neq",
  "gt",
  "gte",
  "lt",
  "lte",
  "in",
  "not_in",
  "is_empty",
  "is_not_empty",
];

/** Operadores que no llevan valor (comparan contra vacío). */
export const OPERATORS_WITHOUT_VALUE: readonly PolicyOperator[] = [
  "is_empty",
  "is_not_empty",
];

export interface PolicyConditionRow {
  field: string;
  operator: string;
  value: string | null;
}

export interface PolicyRule {
  id: string;
  key: string | null;
  name: string;
  action: string;
  effect: "ALLOW" | "DENY";
  priority: number;
  active: boolean;
  /** Roles a los que aplica; vacío = a todos. */
  roles: string[];
  conditions: PolicyConditionRow[];
}

export type PolicyResource = Record<string, unknown>;

const isOperator = (v: string): v is PolicyOperator =>
  (POLICY_OPERATORS as readonly string[]).includes(v);

/** Resuelve el operando derecho: literal o referencia al usuario (`@user.id`). */
const resolveRight = (raw: string | null | undefined, user: PolicyUser): unknown => {
  if (typeof raw === "string" && raw.startsWith("@user.")) {
    const field = raw.slice("@user.".length) as keyof PolicyUser;
    return user[field] ?? null;
  }
  return raw;
};

const asString = (v: unknown): string => (v == null ? "" : String(v));
const asNumber = (v: unknown): number => Number(v);

/** ¿La condición se cumple para este usuario y este recurso? */
export const conditionMatches = (
  condition: PolicyConditionRow,
  user: PolicyUser,
  resource: PolicyResource
): boolean => {
  const operator = condition.operator;
  if (!isOperator(operator)) return false;
  const left = resource[condition.field];
  const right = resolveRight(condition.value, user);

  switch (operator) {
    case "eq":
      return asString(left) === asString(right);
    case "neq":
      return asString(left) !== asString(right);
    case "gt":
      return asNumber(left) > asNumber(right);
    case "gte":
      return asNumber(left) >= asNumber(right);
    case "lt":
      return asNumber(left) < asNumber(right);
    case "lte":
      return asNumber(left) <= asNumber(right);
    case "in":
      return asString(right)
        .split(",")
        .map((item) => item.trim())
        .includes(asString(left));
    case "not_in":
      return !asString(right)
        .split(",")
        .map((item) => item.trim())
        .includes(asString(left));
    case "is_empty":
      return left == null || asString(left) === "";
    case "is_not_empty":
      return !(left == null || asString(left) === "");
    default:
      return false;
  }
};

/** ¿La regla aplica al usuario (por rol) y cumple todas sus condiciones? */
export const ruleMatches = (
  rule: PolicyRule,
  user: PolicyUser,
  resource: PolicyResource
): boolean => {
  if (!rule.active) return false;
  if (rule.roles.length > 0) {
    const userRoles = rolesOf(user);
    if (!rule.roles.some((role) => userRoles.includes(role))) return false;
  }
  return rule.conditions.every((condition) => conditionMatches(condition, user, resource));
};

/** Primera regla que casa por prioridad (menor = antes). Sin reglas → permite. */
export const evaluateRules = (
  rules: readonly PolicyRule[],
  user: PolicyUser,
  resource: PolicyResource
): PolicyDecision => {
  const ordered = [...rules].sort((a, b) => a.priority - b.priority);
  const matched = ordered.find((rule) => ruleMatches(rule, user, resource));
  if (!matched) return allow();
  if (matched.effect === "DENY") {
    return deny("POLICY_DENIED", `La política "${matched.name}" no lo permite.`);
  }
  return allow();
};

// --- Traza (probador de la consola) ----------------------------------------

export interface ConditionTrace extends PolicyConditionRow {
  /** Valor del campo en el registro evaluado. */
  actual: unknown;
  /** Operando derecho ya resuelto (literal o `@user.*`). */
  expected: unknown;
  matches: boolean;
}

export interface RuleTrace {
  id: string;
  key: string | null;
  name: string;
  effect: "ALLOW" | "DENY";
  priority: number;
  active: boolean;
  roles: string[];
  /** ¿La regla aplica a alguno de los roles del usuario (o a todos)? */
  appliesToUser: boolean;
  conditions: ConditionTrace[];
  /** ¿Casó completa? (activa + rol + todas las condiciones). */
  matches: boolean;
}

export interface PolicyExplanation {
  decision: PolicyDecision;
  /** La regla que decidió (la primera que casa por prioridad) o null. */
  decidedBy: RuleTrace | null;
  /** Todas las reglas de la acción, en el orden en que se evalúan. */
  rules: RuleTrace[];
}

/**
 * Explica la evaluación de `evaluateRules` regla por regla. Reutiliza las
 * mismas funciones (`ruleMatches`, `conditionMatches`) y el mismo orden, así
 * que la decisión que devuelve es exactamente la del motor.
 */
export const explainRules = (
  rules: readonly PolicyRule[],
  user: PolicyUser,
  resource: PolicyResource
): PolicyExplanation => {
  const userRoles = rolesOf(user);
  const ordered = [...rules].sort((a, b) => a.priority - b.priority);
  const traces = ordered.map<RuleTrace>((rule) => ({
    id: rule.id,
    key: rule.key,
    name: rule.name,
    effect: rule.effect,
    priority: rule.priority,
    active: rule.active,
    roles: [...rule.roles],
    appliesToUser: rule.roles.length === 0 || rule.roles.some((role) => userRoles.includes(role)),
    conditions: rule.conditions.map((condition) => ({
      ...condition,
      actual: resource[condition.field] ?? null,
      expected: resolveRight(condition.value, user) ?? null,
      matches: conditionMatches(condition, user, resource),
    })),
    matches: ruleMatches(rule, user, resource),
  }));
  return {
    decision: evaluateRules(rules, user, resource),
    decidedBy: traces.find((trace) => trace.matches) ?? null,
    rules: traces,
  };
};

// --- Cache en memoria ------------------------------------------------------

let cache: PolicyRule[] = [];

export const getPolicyRules = (): PolicyRule[] => cache;

export const setPolicyRules = (rules: PolicyRule[]): void => {
  cache = rules;
};

export const rulesForAction = (action: string): PolicyRule[] =>
  cache.filter((rule) => rule.action === action);

/** Evalúa las políticas de una acción para el usuario y el contexto dados. */
export const evaluateActionPolicies = (
  action: string,
  user: PolicyUser,
  resource: PolicyResource
): PolicyDecision => evaluateRules(rulesForAction(action), user, resource);

interface PolicyDbRow {
  id: string;
  key: string | null;
  name: string;
  action: string;
  effect: "ALLOW" | "DENY";
  priority: number;
  active: boolean;
  conditions: Array<{ field: string; operator: string; value: string | null }>;
  roles: Array<{ role: string }>;
}

export const policyFromRow = (row: PolicyDbRow): PolicyRule => ({
  id: row.id,
  key: row.key,
  name: row.name,
  action: row.action,
  effect: row.effect,
  priority: row.priority,
  active: row.active,
  roles: row.roles.map((r) => r.role),
  conditions: row.conditions.map((c) => ({
    field: c.field,
    operator: c.operator,
    value: c.value,
  })),
});

/** Traza de las políticas de una acción (mismo resultado que `evaluateActionPolicies`). */
export const explainActionPolicies = (
  action: string,
  user: PolicyUser,
  resource: PolicyResource
): PolicyExplanation => explainRules(rulesForAction(action), user, resource);

/** Lee las políticas de la BD y deja la cache cargada. */
export const loadPoliciesFromDb = async (db: PrismaClient): Promise<void> => {
  const rows = await db.policy.findMany({
    include: {
      conditions: { select: { field: true, operator: true, value: true } },
      roles: { select: { role: true } },
    },
    orderBy: [{ action: "asc" }, { priority: "asc" }],
  });
  setPolicyRules(rows.map(policyFromRow));
};
