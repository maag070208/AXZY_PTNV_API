import { test, expect } from "@playwright/test";
import {
  conditionMatches,
  evaluateRules,
  explainRules,
  ruleMatches,
  setPolicyRules,
  getPolicyRules,
  DEFAULT_POLICIES,
  type PolicyRule,
} from "../../src/core/policies";

/** Motor ABAC dinámico y políticas base sembradas. Puro, sin BD. */

const seededRules = (): PolicyRule[] =>
  DEFAULT_POLICIES.map((policy, index) => ({
    id: `seed-${index}`,
    key: policy.key,
    name: policy.name,
    action: policy.action,
    effect: policy.effect,
    priority: policy.priority,
    active: policy.active,
    roles: [...policy.roles],
    conditions: policy.conditions.map((c) => ({
      field: c.field,
      operator: c.operator,
      value: c.value ?? null,
    })),
  }));

const user = (over: Partial<{ id: string; role: string; roles: string[] }> = {}) => ({
  id: "u1",
  role: "MANAGER",
  roles: ["MANAGER"],
  ...over,
});

test.describe("conditionMatches", () => {
  test("comparaciones numéricas y de texto", () => {
    expect(conditionMatches({ field: "total", operator: "gt", value: "100" }, user(), { total: 150 })).toBe(true);
    expect(conditionMatches({ field: "total", operator: "gt", value: "100" }, user(), { total: 100 })).toBe(false);
    expect(conditionMatches({ field: "status", operator: "eq", value: "DRAFT" }, user(), { status: "DRAFT" })).toBe(true);
    expect(conditionMatches({ field: "status", operator: "neq", value: "DRAFT" }, user(), { status: "SENT" })).toBe(true);
  });

  test("referencia al usuario (@user.id) para la segregación de funciones", () => {
    const cond = { field: "createdById", operator: "eq", value: "@user.id" };
    expect(conditionMatches(cond, user({ id: "u1" }), { createdById: "u1" })).toBe(true);
    expect(conditionMatches(cond, user({ id: "u1" }), { createdById: "u2" })).toBe(false);
  });

  test("in / not_in / is_empty", () => {
    expect(conditionMatches({ field: "status", operator: "in", value: "DRAFT, SENT" }, user(), { status: "SENT" })).toBe(true);
    expect(conditionMatches({ field: "status", operator: "not_in", value: "DRAFT, SENT" }, user(), { status: "APPROVED" })).toBe(true);
    expect(conditionMatches({ field: "notes", operator: "is_empty", value: null }, user(), { notes: "" })).toBe(true);
  });

  test("un operador desconocido no casa", () => {
    expect(conditionMatches({ field: "total", operator: "wat", value: "1" }, user(), { total: 1 })).toBe(false);
  });
});

test.describe("evaluateRules", () => {
  test("sin reglas que casen, permite (lo autoriza el RBAC)", () => {
    expect(evaluateRules([], user(), {}).allowed).toBe(true);
  });

  test("la primera que casa por prioridad decide", () => {
    const rules: PolicyRule[] = [
      { id: "a", key: null, name: "deny", action: "x", effect: "DENY", priority: 10, active: true, roles: [], conditions: [] },
      { id: "b", key: null, name: "allow", action: "x", effect: "ALLOW", priority: 20, active: true, roles: [], conditions: [] },
    ];
    const decision = evaluateRules(rules, user(), {});
    expect(decision.allowed).toBe(false);
    expect(decision.code).toBe("POLICY_DENIED");
  });

  test("una regla inactiva se ignora", () => {
    const rules: PolicyRule[] = [
      { id: "a", key: null, name: "deny", action: "x", effect: "DENY", priority: 1, active: false, roles: [], conditions: [] },
    ];
    expect(evaluateRules(rules, user(), {}).allowed).toBe(true);
  });

  test("el alcance por rol filtra la aplicación", () => {
    const rule: PolicyRule = { id: "a", key: null, name: "n", action: "x", effect: "DENY", priority: 1, active: true, roles: ["ADMIN"], conditions: [] };
    expect(ruleMatches(rule, user({ role: "ADMIN", roles: ["ADMIN"] }), {})).toBe(true);
    expect(ruleMatches(rule, user(), {})).toBe(false);
  });
});

test.describe("políticas base sembradas (comportamiento de las reglas migradas)", () => {
  const rules = seededRules();

  test("aprobación: el creador no aprueba, salvo ADMIN", () => {
    const approve = rules.filter((r) => r.action === "purchase_orders.approve");
    // MANAGER que creó la orden → DENY por SoD.
    expect(
      evaluateRules(approve, user({ id: "m1", role: "MANAGER", roles: ["MANAGER"] }), { createdById: "m1" }).allowed
    ).toBe(false);
    // ADMIN que creó la orden → ALLOW por la excepción (prioridad 10).
    expect(
      evaluateRules(approve, user({ id: "a1", role: "ADMIN", roles: ["ADMIN"] }), { createdById: "a1" }).allowed
    ).toBe(true);
    // Otro que no la creó → ALLOW.
    expect(
      evaluateRules(approve, user({ id: "m2" }), { createdById: "m1" }).allowed
    ).toBe(true);
  });

  test("recepción y factura: quien aprobó no recibe ni factura, salvo ADMIN", () => {
    for (const action of ["purchase_orders.receive", "invoices.register"]) {
      const scoped = rules.filter((r) => r.action === action);
      expect(
        evaluateRules(scoped, user({ id: "m1", role: "MANAGER", roles: ["MANAGER"] }), { approvedById: "m1" }).allowed
      ).toBe(false);
      expect(
        evaluateRules(scoped, user({ id: "a1", role: "ADMIN", roles: ["ADMIN"] }), { approvedById: "a1" }).allowed
      ).toBe(true);
      expect(
        evaluateRules(scoped, user({ id: "m2" }), { approvedById: "m1" }).allowed
      ).toBe(true);
    }
  });

  test("el límite de monto viene inactivo por defecto y se puede activar", () => {
    const limit = rules.find((r) => r.key === "po-approve-limit")!;
    expect(limit.active).toBe(false);

    const activeLimit: PolicyRule = { ...limit, active: true };
    const scoped = rules
      .filter((r) => r.action === "purchase_orders.approve")
      .map((r) => (r.key === "po-approve-limit" ? activeLimit : r));
    expect(
      evaluateRules(scoped, user({ id: "m2" }), { createdById: "m1", total: 50_000 }).allowed
    ).toBe(false);
  });
});

test.describe("cache", () => {
  test("setPolicyRules reemplaza la cache", () => {
    setPolicyRules(seededRules());
    expect(getPolicyRules().length).toBe(DEFAULT_POLICIES.length);
  });
});

test.describe("explainRules (probador de /roles)", () => {
  const rules = seededRules().filter((rule) => rule.action === "purchase_orders.approve");

  test("decide igual que el motor y señala la regla que decidió", () => {
    const cases = [
      { who: user({ id: "u1" }), resource: { createdById: "u1", total: 500 } },
      { who: user({ id: "u1" }), resource: { createdById: "u2", total: 500 } },
      { who: user({ id: "u1", role: "ADMIN", roles: ["ADMIN"] }), resource: { createdById: "u1", total: 500 } },
    ];
    for (const { who, resource } of cases) {
      const explanation = explainRules(rules, who, resource);
      expect(explanation.decision).toEqual(evaluateRules(rules, who, resource));
      const first = explanation.rules.find((trace) => trace.matches) ?? null;
      expect(explanation.decidedBy).toEqual(first);
    }
  });

  test("traza en orden de prioridad con el valor real y el esperado de cada condición", () => {
    const explanation = explainRules(rules, user({ id: "u1" }), { createdById: "u1" });
    const priorities = explanation.rules.map((trace) => trace.priority);
    expect(priorities).toEqual([...priorities].sort((a, b) => a - b));
    const sod = explanation.rules
      .flatMap((trace) => trace.conditions)
      .find((condition) => condition.value === "@user.id");
    expect(sod?.actual).toBe("u1");
    expect(sod?.expected).toBe("u1");
    expect(sod?.matches).toBe(true);
  });

  test("marca si la regla aplica a los roles del usuario", () => {
    const scoped: PolicyRule = {
      id: "r1", key: null, name: "Solo cocina", action: "x", effect: "DENY", priority: 1,
      active: true, roles: ["CHEF"], conditions: [],
    };
    expect(explainRules([scoped], user(), {}).rules[0].appliesToUser).toBe(false);
    expect(explainRules([scoped], user({ roles: ["MANAGER", "CHEF"] }), {}).rules[0].appliesToUser).toBe(true);
  });
});
