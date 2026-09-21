import bcrypt from "bcryptjs";
import jwt, { type SignOptions } from "jsonwebtoken";
import { env } from "@core/config/env.config";

export type UserRole = "ADMIN" | "GERENTE" | "JEFE_DE_AREA" | "EMPLEADO" | "RECURSOS_HUMANOS";

export const isPrivileged = (role: string): boolean =>
  role === "ADMIN" || role === "GERENTE";

export interface JwtPayload {
  id: string;
  username: string;
  role: UserRole;
  departmentId?: string | null;
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