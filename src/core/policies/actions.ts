/**
 * Catálogo de acciones que admiten políticas ABAC dinámicas. Cada acción declara
 * los **campos del recurso** que un administrador puede usar en las condiciones.
 * Es la frontera de seguridad del motor: solo se evalúan estos campos (nunca SQL
 * ni accesos arbitrarios). Para exponer una acción nueva se agrega aquí y el
 * servicio que la ejecuta entrega su contexto al motor (`evaluateActionPolicies`).
 */
export type PolicyFieldType = "string" | "number" | "boolean" | "enum" | "user";

export interface PolicyFieldDef {
  key: string;
  label: string;
  type: PolicyFieldType;
  /** Valores permitidos cuando `type = "enum"`. */
  options?: string[];
}

export interface PolicyActionDef {
  /** Clave de permiso de la acción (coincide con `requiresPermission`). */
  key: string;
  label: string;
  module: string;
  fields: PolicyFieldDef[];
}

const PURCHASE_ORDER_STATUS = [
  "DRAFT",
  "APPROVED",
  "SENT",
  "PARTIALLY_RECEIVED",
  "RECEIVED",
  "CANCELLED",
];

export const POLICY_ACTIONS: readonly PolicyActionDef[] = [
  {
    key: "purchase_orders.approve",
    label: "Aprobar orden de compra",
    module: "Cocina",
    fields: [
      { key: "total", label: "Total", type: "number" },
      { key: "status", label: "Estado", type: "enum", options: PURCHASE_ORDER_STATUS },
      { key: "createdById", label: "Creador", type: "user" },
      { key: "approvedById", label: "Aprobador", type: "user" },
    ],
  },
  {
    key: "purchase_orders.receive",
    label: "Recibir orden de compra",
    module: "Cocina",
    fields: [
      { key: "status", label: "Estado", type: "enum", options: PURCHASE_ORDER_STATUS },
      { key: "createdById", label: "Creador", type: "user" },
      { key: "approvedById", label: "Aprobador", type: "user" },
    ],
  },
  {
    key: "invoices.register",
    label: "Registrar factura de proveedor",
    module: "Cocina",
    fields: [
      { key: "status", label: "Estado de la OC", type: "enum", options: PURCHASE_ORDER_STATUS },
      { key: "createdById", label: "Creador de la OC", type: "user" },
      { key: "approvedById", label: "Aprobador de la OC", type: "user" },
    ],
  },
];

export const policyAction = (key: string): PolicyActionDef | undefined =>
  POLICY_ACTIONS.find((action) => action.key === key);
