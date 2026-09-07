import { Request, Response, NextFunction } from "express";
import { verifyToken, type JwtPayload, type UserRole } from "@core/utils/security";
import { HttpError } from "./error.middleware";
import { prismaClient } from "@core/config/database";

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
  if (!header) throw new HttpError(401, "No se proporcionó token");
  const parts = header.split(" ");
  if (parts.length !== 2 || parts[0] !== "Bearer") {
    throw new HttpError(401, "Formato de Authorization inválido");
  }

  let payload: JwtPayload;
  try {
    payload = verifyToken(parts[1]);
  } catch {
    throw new HttpError(401, "Token inválido o expirado");
  }

  prismaClient.user
    .findUnique({ where: { id: payload.id }, select: { id: true, active: true } })
    .then((user) => {
      if (!user || !user.active) {
        next(new HttpError(401, "Sesión inválida: el usuario ya no existe o está inactivo"));
        return;
      }
      req.user = payload;
      next();
    })
    .catch(next);
};

export const authorize = (roles: UserRole[]) => {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) throw new HttpError(401, "No autenticado");
    if (!roles.includes(req.user.role)) {
      throw new HttpError(403, "Permisos insuficientes");
    }
    next();
  };
};
