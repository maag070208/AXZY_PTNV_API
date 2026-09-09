import { prismaClient } from "@core/config/database";
import {
  comparePassword,
  signToken,
  type JwtPayload,
  type UserRole,
} from "@core/utils/security";
import { HttpError } from "@core/middlewares/error.middleware";

export interface AuthResponse {
  token: string;
  user: {
    id: string;
    username: string;
    email?: string | null;
    name: string;
    role: UserRole;
    departmentId?: string | null;
  };
}

export const login = async (
  username: string,
  password: string
): Promise<AuthResponse> => {
  const user = await prismaClient.user.findUnique({ where: { username } });
  if (!user || !user.active) throw new HttpError(401, "Credenciales inválidas");

  const ok = await comparePassword(password, user.password);
  if (!ok) throw new HttpError(401, "Credenciales inválidas");

  const payload: JwtPayload = {
    id: user.id,
    username: user.username,
    role: user.role,
    departmentId: user.departmentId,
  };
  const token = signToken(payload);

  return {
    token,
    user: {
      id: user.id,
      username: user.username,
      email: user.email,
      name: user.name,
      role: user.role,
      departmentId: user.departmentId,
    },
  };
};

export const me = async (userId: string) => {
  const user = await prismaClient.user.findUnique({ where: { id: userId } });
  if (!user || !user.active) throw new HttpError(404, "Usuario no encontrado");
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    name: user.name,
    role: user.role,
    departmentId: user.departmentId,
  };
};
