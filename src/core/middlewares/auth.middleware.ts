import { Request, Response, NextFunction } from "express";
import { verifyToken, type JwtPayload, type UserRole } from "@core/utils/security";
import { HttpError } from "./error.middleware";

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

  try {
    const payload = verifyToken(parts[1]);
    req.user = payload;
    next();
  } catch {
    throw new HttpError(401, "Token inválido o expirado");
  }
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