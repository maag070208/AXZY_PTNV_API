import { Request, Response, NextFunction } from "express";
import { verifyToken, type JwtPayload } from "@core/utils/security";
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
  } catch {
    throw new HttpError(401, "INVALID_TOKEN");
  }

  prismaClient.user
    .findUnique({
      where: { id: payload.id },
      select: { id: true, active: true, role: true, departmentId: true },
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
        departmentId: user.departmentId,
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
      throw new HttpError(403, "INSUFFICIENT_PERMISSIONS");
    }
    if (scopeOf(req.user, permission) === "NONE") {
      throw new HttpError(403, "INSUFFICIENT_PERMISSIONS");
    }
    next();
  };
};
