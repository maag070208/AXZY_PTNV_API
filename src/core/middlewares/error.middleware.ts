import { Request, Response, NextFunction } from "express";
import { Prisma } from "@prisma/client";
import { logger } from "../utils/logger";
import { ZodError } from "zod";
import {
  currentLanguage,
  languageFromHeader,
  t,
  type ErrorCode,
  type Language,
  type MessageParams,
} from "../i18n";

export class HttpError extends Error {
  /**
   * `code` es estable y legible por máquina (UPPER_SNAKE): el cliente distingue
   * errores de flujo (INVALID_CREDENTIALS, ACCOUNT_DEACTIVATED) sin parsear
   * mensajes. El mensaje se traduce al responder, en el idioma de la petición;
   * `message` queda en inglés para los logs.
   */
  constructor(
    public status: number,
    public readonly code: ErrorCode,
    public readonly params: MessageParams = {},
    public details?: unknown
  ) {
    super(t(`errors.${code}`, params, "en"));
    this.name = "HttpError";
  }
}

const languageOf = (req: Request): Language =>
  languageFromHeader(req.headers["accept-language"]) ?? currentLanguage();

const prismaErrorMapper = (
  err: Prisma.PrismaClientKnownRequestError
): { status: number; code: ErrorCode; details: unknown } => {
  switch (err.code) {
    case "P2002":
      return { status: 409, code: "DUPLICATE_RECORD", details: { target: err.meta?.target } };
    case "P2025":
      return { status: 404, code: "RECORD_NOT_FOUND", details: err.meta };
    case "P2003":
      return { status: 400, code: "INVALID_REFERENCE", details: err.meta };
    default:
      return { status: 500, code: "DATABASE_ERROR", details: { code: err.code } };
  }
};

export const notFoundMiddleware = (req: Request, res: Response, _next: NextFunction): void => {
  res.status(404).json({
    error: "NotFoundError",
    code: "ROUTE_NOT_FOUND",
    message: t("errors.ROUTE_NOT_FOUND", { method: req.method, path: req.originalUrl }, languageOf(req)),
  });
};

export const errorMiddleware = (
  err: Error,
  req: Request,
  res: Response,
  _next: NextFunction
): void => {
  const lng = languageOf(req);

  if (err instanceof ZodError) {
    res.status(400).json({
      error: "ValidationError",
      code: "VALIDATION_ERROR",
      message: t("errors.VALIDATION_ERROR", {}, lng),
      details: err.flatten(),
    });
    return;
  }

  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    const mapped = prismaErrorMapper(err);
    res.status(mapped.status).json({
      error: "PrismaError",
      code: mapped.code,
      message: t(`errors.${mapped.code}`, {}, lng),
      details: mapped.details,
    });
    return;
  }

  if (err instanceof HttpError) {
    res.status(err.status).json({
      error: err.name,
      code: err.code,
      message: t(`errors.${err.code}`, err.params, lng),
      details: err.details,
    });
    return;
  }

  logger.error(err.stack ?? err.message);
  res.status(500).json({
    error: "InternalServerError",
    code: "INTERNAL_ERROR",
    message: t("errors.INTERNAL_ERROR", {}, lng),
    details: err.message,
  });
};
