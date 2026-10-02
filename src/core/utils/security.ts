import bcrypt from "bcryptjs";
import jwt, { type SignOptions } from "jsonwebtoken";
import { env } from "@core/config/env.config";

export type UserRole = string;

export interface JwtPayload {
  id: string;
  username: string;
  /** Rol principal. */
  role: string;
  /** Roles adicionales (multi-rol). */
  roles?: string[];
  departmentId?: string | null;
  /** Excepciones de permiso vigentes (Fase 2). */
  exceptions?: Array<{
    permission: string;
    scope: "NONE" | "OWN" | "AREA" | "ALL";
    expiresAt?: Date | null;
  }>;
}

export const hashPassword = async (plain: string): Promise<string> =>
  bcrypt.hash(plain, 10);

export const comparePassword = async (
  plain: string,
  hash: string
): Promise<boolean> => bcrypt.compare(plain, hash);

export const signToken = (payload: JwtPayload): string => {
  const opts: SignOptions = {
    expiresIn: env.JWT_EXPIRES_IN as SignOptions["expiresIn"],
  };
  return jwt.sign(payload, env.JWT_SECRET, opts);
};

export const verifyToken = (token: string): JwtPayload => {
  return jwt.verify(token, env.JWT_SECRET) as JwtPayload;
};

/** Payload del refresh token: solo identifica; no lleva rol ni permisos. */
export interface RefreshPayload {
  id: string;
  username: string;
  type: "refresh";
}

/** Firma un refresh token de vida larga (endurecimiento: access corto + refresh). */
export const signRefreshToken = (payload: { id: string; username: string }): string => {
  const opts: SignOptions = {
    expiresIn: env.JWT_REFRESH_EXPIRES_IN as SignOptions["expiresIn"],
  };
  return jwt.sign({ ...payload, type: "refresh" }, env.JWT_SECRET, opts);
};

/** Verifica un refresh token y exige el claim `type: "refresh"`. */
export const verifyRefreshToken = (token: string): RefreshPayload => {
  const payload = jwt.verify(token, env.JWT_SECRET) as RefreshPayload;
  if (payload.type !== "refresh") throw new Error("NOT_A_REFRESH_TOKEN");
  return payload;
};

/** ¿El token es un refresh (no sirve como access)? */
export const isRefreshToken = (payload: unknown): boolean =>
  typeof payload === "object" && payload !== null && (payload as { type?: string }).type === "refresh";