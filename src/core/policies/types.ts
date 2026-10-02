/**
 * Capa de políticas (ABAC) del ERP. Separa el "puede intentarlo" (permiso RBAC,
 * `requiresPermission`) del "puede hacerlo sobre ESTE registro ahora": reglas de
 * contexto como segregación de funciones, estado del recurso o límites de monto.
 *
 * Las políticas son funciones puras: reciben el contexto ya resuelto y
 * devuelven una decisión. El servicio que las usa es quien decide qué hacer con
 * un `allowed: false` (normalmente un 403 con el motivo).
 */
export interface PolicyDecision {
  allowed: boolean;
  /** Código estable (para la respuesta del API y los tests). */
  code?: string;
  /** Motivo legible para el usuario. */
  reason?: string;
}

/** Contexto mínimo del usuario para evaluar políticas. */
export interface PolicyUser {
  id: string;
  /** Rol principal. */
  role: string;
  /** Roles adicionales (multi-rol). */
  roles?: readonly string[];
  departmentId?: string | null;
}

export const allow = (): PolicyDecision => ({ allowed: true });

export const deny = (code: string, reason: string): PolicyDecision => ({
  allowed: false,
  code,
  reason,
});
