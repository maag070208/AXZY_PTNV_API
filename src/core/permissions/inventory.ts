/**
 * Permisos de lectura de inventario (§9 #2 de ROLES_AND_PERMISSIONS.md). Antes
 * los GET de inventario eran abiertos a cualquier sesión; ahora exigen alguno de
 * estos. Vive en el núcleo para que el guard de fixtures lo valide contra el
 * catálogo (no puede haber claves inventadas).
 */
export const INVENTORY_READ_PERMISSIONS = [
  "devices.view",
  "devices.create",
  "devices.edit",
  "loans.view",
  "loans.create",
  "loans.edit",
] as const;

/** Lecturas de préstamos y devoluciones. */
export const LOAN_READ_PERMISSIONS = [
  "loans.view",
  "loans.create",
  "loans.edit",
] as const;
