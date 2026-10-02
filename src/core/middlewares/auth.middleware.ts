import { Request, Response, NextFunction } from "express";
import { verifyToken, isRefreshToken, type JwtPayload } from "@core/utils/security";
import { HttpError } from "./error.middleware";
import { prismaClient } from "@core/config/database";
import { scopeOf, isPermission } from "@core/permissions";
import { logger } from "@core/utils/logger";

declare global {
  namespace Express {
    interface Request {
      user?: JwtPayload;
    }
    interface Response {
      locals: {
        user?: JwtPayload;
      };
    }
  }
}

// Verifica la firma del token y, además, que el usuario que dice ser siga
// existiendo y activo en la base de datos. Sin esto, un usuario borrado o
// desactivado (por ejemplo tras un reset de seed) se queda con una sesión
// "válida" en el navegador que truena con errores de FK en cuanto intenta
// crear algo — en vez de eso, aquí se corta con 401 y el interceptor del
// frontend cierra la sesión automáticamente.
export const authenticate = (
  req: Request,
  _res: Response,
  next: NextFunction
): void => {
  const header = req.headers.authorization;
  if (!header) throw new HttpError(401, "TOKEN_MISSING");
  const parts = header.split(" ");
  if (parts.length !== 2 || parts[0] !== "Bearer") {
    throw new HttpError(401, "INVALID_AUTHORIZATION_HEADER");
  }

  let payload: JwtPayload;
  try {
    payload = verifyToken(parts[1]);
    // Un refresh token no sirve como access: solo identifica para renovar.
    if (isRefreshToken(payload)) {
      throw new Error("NOT_AN_ACCESS_TOKEN");
    }
  } catch {
    throw new HttpError(401, "INVALID_TOKEN");
  }

  prismaClient.user
    .findUnique({
      where: { id: payload.id },
      select: {
        id: true,
        active: true,
        role: true,
        departmentId: true,
        extraRoles: { select: { role: true } },
        permissionGrants: {
          where: { OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
          select: { permission: true, scope: true, expiresAt: true },
        },
      },
    })
    .then((user) => {
      if (!user || !user.active) {
        next(new HttpError(401, "INVALID_SESSION"));
        return;
      }
      // El rol y el departamento frescos de la base mandan sobre los claims del
      // JWT: un cambio de rol o de área aplica en la siguiente petición.
      req.user = {
        ...payload,
        role: user.role,
        roles: [user.role, ...user.extraRoles.map((r) => r.role)],
        departmentId: user.departmentId,
        exceptions: user.permissionGrants.map((grant) => ({
          permission: grant.permission,
          scope: grant.scope,
          expiresAt: grant.expiresAt,
        })),
      };
      next();
    })
    .catch(next);
};

/**
 * Exige un permiso con cualquier alcance distinto de NINGUNO. Es el reemplazo
 * de `authorize([...])` en las rutas: el alcance por registro lo aplica el
 * servicio con las funciones de `@core/permisos`.
 *
 * Si la clave no está en el catálogo activo, la ruta queda cerrada (403) y se
 * avisa una sola vez por clave: un permiso mal escrito no abre nada.
 */
const warnedPermissions = new Set<string>();

/**
 * Auditoría de intentos denegados (checklist de la guía). Se escribe en
 * segundo plano: un fallo al registrar nunca cambia la respuesta (que ya es 403).
 */
const recordDeniedAccess = (req: Request, permission: string): void => {
  const user = req.user;
  void prismaClient.auditLog
    .create({
      data: {
        action: "ACCESS_DENIED",
        entityType: "Permission",
        entityId: permission,
        userId: user?.id ?? null,
        userName: user?.username ?? null,
        metadata: { path: req.originalUrl, method: req.method },
      },
    })
    .catch(() => undefined);
};

export const requiresPermission = (permission: string) => {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) throw new HttpError(401, "UNAUTHENTICATED");
    if (!isPermission(permission)) {
      if (!warnedPermissions.has(permission)) {
        warnedPermissions.add(permission);
        logger.warn(
          `Unknown permission "${permission}": the route stays closed (403)`
        );
      }
      recordDeniedAccess(req, permission);
      throw new HttpError(403, "INSUFFICIENT_PERMISSIONS");
    }
    if (scopeOf(req.user, permission) === "NONE") {
      recordDeniedAccess(req, permission);
      throw new HttpError(403, "INSUFFICIENT_PERMISSIONS");
    }
    next();
  };
};

/**
 * Exige **al menos uno** de los permisos. Útil en lecturas compartidas: p. ej.
 * los catálogos de inventario los necesitan tanto quien ve dispositivos como
 * quien crea un préstamo. Cada clave se evalúa de forma independiente.
 */
export const requiresAnyPermission = (permissions: readonly string[]) => {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const user = req.user;
    if (!user) throw new HttpError(401, "UNAUTHENTICATED");
    const allowed = permissions.some(
      (permission) => isPermission(permission) && scopeOf(user, permission) !== "NONE"
    );
    if (!allowed) {
      recordDeniedAccess(req, permissions.join("|"));
      throw new HttpError(403, "INSUFFICIENT_PERMISSIONS");
    }
    next();
  };
};
