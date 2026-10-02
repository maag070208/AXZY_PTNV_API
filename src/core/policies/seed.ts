import type { PrismaClient } from "@prisma/client";
import { loadPoliciesFromDb } from "./engine";

/**
 * Políticas base sembradas (insert-missing por `key`). Reproducen las reglas que
 * antes vivían en código: la excepción del ADMIN (ALLOW), la segregación de
 * funciones (DENY) y un límite de monto de ejemplo (inactivo). Se pueden editar o
 * desactivar desde la web.
 */
interface SeedCondition {
  field: string;
  operator: string;
  value?: string | null;
}

interface SeedPolicy {
  key: string;
  name: string;
  description: string;
  action: string;
  effect: "ALLOW" | "DENY";
  priority: number;
  active: boolean;
  roles: string[];
  conditions: SeedCondition[];
}

export const DEFAULT_POLICIES: readonly SeedPolicy[] = [
  {
    key: "po-approve-admin-override",
    name: "ADMIN puede aprobar lo que creó",
    description: "Excepción de segregación de funciones para el rol ADMIN.",
    action: "purchase_orders.approve",
    effect: "ALLOW",
    priority: 10,
    active: true,
    roles: ["ADMIN"],
    conditions: [],
  },
  {
    key: "po-approve-sod",
    name: "SoD: el creador no aprueba su orden",
    description: "Segregación de funciones en la aprobación de órdenes de compra.",
    action: "purchase_orders.approve",
    effect: "DENY",
    priority: 20,
    active: true,
    roles: [],
    conditions: [{ field: "createdById", operator: "eq", value: "@user.id" }],
  },
  {
    key: "po-approve-limit",
    name: "Límite de monto para aprobar",
    description:
      "Ejemplo (inactivo): niega aprobar órdenes por encima del monto. Actívalo y ajusta el valor a tu política.",
    action: "purchase_orders.approve",
    effect: "DENY",
    priority: 30,
    active: false,
    roles: [],
    conditions: [{ field: "total", operator: "gt", value: "10000" }],
  },
  {
    key: "po-receive-admin-override",
    name: "ADMIN puede recibir lo que aprobó",
    description: "Excepción de segregación de funciones para el rol ADMIN.",
    action: "purchase_orders.receive",
    effect: "ALLOW",
    priority: 10,
    active: true,
    roles: ["ADMIN"],
    conditions: [],
  },
  {
    key: "po-receive-sod",
    name: "SoD: quien aprobó no recibe la orden",
    description: "Segregación de funciones en la recepción de órdenes de compra.",
    action: "purchase_orders.receive",
    effect: "DENY",
    priority: 20,
    active: true,
    roles: [],
    conditions: [{ field: "approvedById", operator: "eq", value: "@user.id" }],
  },
  {
    key: "invoice-register-admin-override",
    name: "ADMIN puede facturar lo que aprobó",
    description: "Excepción de segregación de funciones para el rol ADMIN.",
    action: "invoices.register",
    effect: "ALLOW",
    priority: 10,
    active: true,
    roles: ["ADMIN"],
    conditions: [],
  },
  {
    key: "invoice-register-sod",
    name: "SoD: quien aprobó no registra la factura",
    description: "Segregación de funciones en el registro de facturas de proveedor.",
    action: "invoices.register",
    effect: "DENY",
    priority: 20,
    active: true,
    roles: [],
    conditions: [{ field: "approvedById", operator: "eq", value: "@user.id" }],
  },
];

/**
 * Siembra las políticas base (insert-missing) y deja la cache cargada. Idempotente.
 */
export const seedPoliciesFromFixtures = async (db: PrismaClient): Promise<void> => {
  for (const policy of DEFAULT_POLICIES) {
    const existing = await db.policy.findUnique({ where: { key: policy.key } });
    if (existing) continue;
    await db.policy.create({
      data: {
        key: policy.key,
        name: policy.name,
        description: policy.description,
        action: policy.action,
        effect: policy.effect,
        priority: policy.priority,
        active: policy.active,
        conditions: {
          create: policy.conditions.map((condition) => ({
            field: condition.field,
            operator: condition.operator,
            value: condition.value ?? null,
          })),
        },
        roles: { create: policy.roles.map((role) => ({ role })) },
      },
    });
  }
  await loadPoliciesFromDb(db);
};
