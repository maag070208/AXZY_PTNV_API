import { Request, Response, NextFunction } from "express";
import { Prisma } from "@prisma/client";
import { logger } from "../utils/logger";
import { ZodError } from "zod";

export class HttpError extends Error {
  constructor(
    public status: number,
    public override: string,
    public details?: unknown
  ) {
    super(override);
    this.name = "HttpError";
  }
}

const prismaErrorMapper = (
  err: Prisma.PrismaClientKnownRequestError
): Pick<HttpError, "status" | "message" | "details"> => {
  switch (err.code) {
    case "P2002":
      return {
        status: 409,
        message: "Ya existe un registro con esos datos (duplicado)",
        details: { target: err.meta?.target },
      };
    case "P2025":
      return {
        status: 404,
        message: "Registro no encontrado",
        details: err.meta,
      };
    case "P2003":
      return {
        status: 400,
        message: "Referencia inválida: dependencia de otro registro",
        details: err.meta,
      };
    default:
      return {
        status: 500,
        message: "Error de base de datos",
        details: { code: err.code },
      };
  }
};

export const notFoundMiddleware = (req: Request, res: Response, _next: NextFunction): void => {
  res.status(404).json({
    error: "NotFoundError",
    message: `No existe la ruta ${req.method} ${req.originalUrl}`,
  });
};

export const errorMiddleware = (
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction
): void => {
  if (err instanceof ZodError) {
    res.status(400).json({
      error: "ValidationError",
      details: err.flatten(),
    });
    return;
  }

  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    const mapped = prismaErrorMapper(err);
    res.status(mapped.status).json({
      error: "PrismaError",
      message: mapped.message,
      details: mapped.details,
    });
    return;
  }

  if (err instanceof HttpError) {
    res.status(err.status).json({
      error: err.name,
      message: err.message,
      details: err.details,
    });
    return;
  }

  logger.error(err.stack ?? err.message);
  res.status(500).json({
    error: "InternalServerError",
    message: err.message ?? "Something went wrong",
  });
};