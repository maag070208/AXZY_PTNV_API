import { Request, Response, NextFunction } from "express";
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