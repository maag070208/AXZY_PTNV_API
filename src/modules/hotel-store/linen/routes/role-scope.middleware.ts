import type { NextFunction, Request, Response } from "express";
import { assertCanCount, assertNotFloorAssistant } from "../services/role-scope-rules";

const rolesOf = (req: Request): string[] | undefined => (req.user as unknown as { roles?: string[] } | undefined)?.roles;

/** Existencias, bajas, flujo y reportes: no para la Auxiliar de piso (403 HOTEL_SCOPE_FLOOR_ASSISTANT). */
export const forbidFloorAssistant = (req: Request, _res: Response, next: NextFunction): void => {
  assertNotFloorAssistant(rolesOf(req));
  next();
};

/** Conteos físicos: ni la Auxiliar de piso ni Lavandería. */
export const forbidCounting = (req: Request, _res: Response, next: NextFunction): void => {
  assertCanCount(rolesOf(req));
  next();
};
